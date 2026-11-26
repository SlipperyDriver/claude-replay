import { redactTimeline } from './redact.js';

const HANDLED_TYPES = new Set(['user', 'assistant', 'attachment', 'agent-setting', 'permission-mode']);

const SUMMARY_FIELDS = {
  Bash: 'command',
  Read: 'file_path',
  Write: 'file_path',
  Edit: 'file_path',
  NotebookEdit: 'file_path',
  Grep: 'pattern',
  Glob: 'pattern',
  WebFetch: 'url',
  WebSearch: 'query',
};

const MAX_SUMMARY_LENGTH = 120;
const DEFAULT_MAX_RESULT_LINES = 20;

function firstStringValue(input) {
  for (const value of Object.values(input)) {
    if (typeof value === 'string') return value;
  }
  return '';
}

function summarizeToolUse(name, rawInput) {
  const input = rawInput !== null && typeof rawInput === 'object' ? rawInput : {};
  let text;
  if ((name === 'Agent' || name === 'Task') && typeof input.subagent_type === 'string' && typeof input.description === 'string') {
    text = `${input.subagent_type}: ${input.description}`;
  } else {
    const field = SUMMARY_FIELDS[name];
    text = typeof input[field] === 'string' ? input[field] : firstStringValue(input);
  }
  if (name === 'Bash') text = text.split('\n')[0];
  return text.length > MAX_SUMMARY_LENGTH ? `${text.slice(0, MAX_SUMMARY_LENGTH)}…` : text;
}

function contextTokensOf(usage) {
  if (usage === null || typeof usage !== 'object') return undefined;
  return (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
}

function toolResultText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .flatMap((part) => {
      if (part?.type === 'image') return ['[image]'];
      if (part?.type === 'text' && typeof part.text === 'string') return [part.text];
      return [];
    })
    .join('\n');
}

function promptFromString(content, entry) {
  const command = /<command-name>\s*([^<]*?)\s*<\/command-name>/.exec(content);
  if (command) {
    if (command[1] === '/clear') return null;
    const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(content)?.[1].trim() ?? '';
    return args ? `${command[1]} ${args}` : command[1];
  }
  const head = content.trimStart();
  if (head.startsWith('<local-command-') || head.startsWith('<task-notification')) return null;
  if (entry.origin?.kind !== undefined && entry.origin.kind !== 'human') return null;
  return content;
}

function lastPathSegment(path) {
  if (typeof path !== 'string') return null;
  return path.split(/[\\/]/).filter(Boolean).pop() ?? null;
}

export function parseTranscript(jsonlText, options = {}) {
  const maxResultLines = options.maxResultLines ?? DEFAULT_MAX_RESULT_LINES;
  const meta = {
    agent: null,
    permissionMode: null,
    model: null,
    modelId: null,
    effort: null,
    claudeVersion: null,
    cwd: null,
    branch: null,
    isWorktree: false,
  };
  const entries = [];
  const toolUses = new Map();
  let skippedLines = 0;
  let turn = 0;
  let lastTs = 0;
  let toolCount = 0;
  let firstAssistantModel = null;
  let environmentSeen = false;

  const setFirst = (key, value) => {
    if (meta[key] === null && typeof value === 'string' && value !== '') meta[key] = value;
  };

  const push = (ts, type, fields, contextTokens) => {
    const event = { type, t: 0, turn };
    if (contextTokens !== undefined) event.contextTokens = contextTokens;
    Object.assign(event, fields);
    entries.push({ ts, event });
    return event;
  };

  const pushPrompt = (ts, text) => {
    turn += 1;
    push(ts, 'prompt', { text });
  };

  const addToolResult = (item, entry, ts) => {
    const use = toolUses.get(item.tool_use_id);
    if (!use) return;
    const text =
      entry.toolUseResult?.status === 'async_launched' ? 'Running in background' : toolResultText(item.content);
    const allLines = text.split('\n');
    push(ts, 'tool_result', {
      toolUseId: use.id,
      isError: item.is_error === true,
      lines: allLines.slice(0, maxResultLines),
      totalLines: allLines.length,
    });
    if (use.event.durationMs === undefined) use.event.durationMs = Math.max(0, Math.round(ts - use.ts));
  };

  const handleAttachment = (entry) => {
    const attachment = entry.attachment ?? entry;
    if (attachment.type === 'model') {
      setFirst('model', attachment.identity?.marketingName);
      setFirst('modelId', attachment.identity?.modelId);
    } else if (attachment.type === 'environment' && !environmentSeen) {
      environmentSeen = true;
      meta.isWorktree = attachment.snapshot?.isWorktree === true;
    }
  };

  const handleUser = (entry, ts) => {
    if (entry.isMeta === true) return;
    const content = entry.message?.content;
    if (typeof content === 'string') {
      const text = promptFromString(content, entry);
      if (text !== null) pushPrompt(ts, text);
      return;
    }
    if (!Array.isArray(content)) return;
    const promptParts = [];
    for (const item of content) {
      if (item?.type === 'tool_result') addToolResult(item, entry, ts);
      else if (item?.type === 'text' && typeof item.text === 'string') promptParts.push(item.text);
      else if (item?.type === 'image') promptParts.push('[Image]');
    }
    if (entry.promptSource === 'typed' && promptParts.length > 0) pushPrompt(ts, promptParts.join('\n'));
  };

  const handleAssistant = (entry, ts) => {
    const message = entry.message ?? {};
    setFirst('effort', entry.effort);
    if (firstAssistantModel === null && typeof message.model === 'string') firstAssistantModel = message.model;
    const blocks =
      typeof message.content === 'string'
        ? [{ type: 'text', text: message.content }]
        : Array.isArray(message.content)
          ? message.content
          : [];
    const contextTokens = contextTokensOf(message.usage);
    for (const block of blocks) {
      if (block?.type === 'thinking') {
        const previousTs = entries.length > 0 ? entries[entries.length - 1].ts : ts;
        const fields = {
          durationMs:
            typeof entry.thinkingDurationMs === 'number'
              ? entry.thinkingDurationMs
              : Math.max(0, Math.round(ts - previousTs)),
        };
        if (options.thinkingText && typeof block.thinking === 'string') fields.text = block.thinking;
        push(ts, 'thinking', fields, contextTokens);
      } else if (block?.type === 'text' && typeof block.text === 'string') {
        push(ts, 'text', { text: block.text }, contextTokens);
      } else if (block?.type === 'tool_use') {
        toolCount += 1;
        const id = `t${toolCount}`;
        const name = typeof block.name === 'string' ? block.name : '';
        const event = push(ts, 'tool_use', { id, name, summary: summarizeToolUse(name, block.input) }, contextTokens);
        toolUses.set(block.id, { id, event, ts });
      }
    }
  };

  for (const line of jsonlText.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      skippedLines += 1;
      continue;
    }
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      skippedLines += 1;
      continue;
    }
    if (!HANDLED_TYPES.has(entry.type) || entry.isSidechain === true) continue;

    const parsedTs = Date.parse(entry.timestamp);
    const ts = Number.isFinite(parsedTs) ? parsedTs : lastTs;
    lastTs = ts;

    if (entry.type === 'agent-setting') {
      setFirst('agent', entry.agentSetting);
    } else if (entry.type === 'permission-mode') {
      setFirst('permissionMode', entry.permissionMode);
    } else if (entry.type === 'attachment') {
      handleAttachment(entry);
    } else {
      setFirst('claudeVersion', entry.version);
      setFirst('cwd', entry.cwd);
      setFirst('branch', entry.gitBranch);
      if (entry.type === 'user') {
        if (entry.promptSource === 'typed') setFirst('permissionMode', entry.permissionMode);
        handleUser(entry, ts);
      } else {
        handleAssistant(entry, ts);
      }
    }
  }

  if (meta.model === null) meta.model = firstAssistantModel;
  if (meta.modelId === null) meta.modelId = firstAssistantModel;

  const range = Array.isArray(options.turns) ? options.turns : null;
  const kept = entries.filter(
    ({ event }) => event.turn >= 1 && (range === null || (event.turn >= range[0] && event.turn <= range[1])),
  );
  let previousT = 0;
  for (const { ts, event } of kept) {
    previousT = Math.max(previousT, Math.round(ts - kept[0].ts));
    event.t = previousT;
  }

  const timeline = {
    version: 1,
    meta: {
      title: options.title ?? null,
      claudeVersion: meta.claudeVersion,
      model: meta.model,
      modelId: meta.modelId,
      effort: meta.effort,
      agent: meta.agent,
      cwd: meta.cwd,
      project: null,
      branch: meta.branch,
      isWorktree: meta.isWorktree,
      permissionMode: meta.permissionMode,
      durationMs: previousT,
    },
    events: kept.map(({ event }) => event),
  };

  const { value, count } = redactTimeline(timeline, {
    username: options.username,
    extraPatterns: options.extraPatterns,
  });
  value.meta.project = lastPathSegment(value.meta.cwd);

  return {
    timeline: value,
    stats: {
      skippedLines,
      redactions: count,
      events: value.events.length,
      turns: new Set(value.events.map((event) => event.turn)).size,
    },
  };
}
