const FORMAT_FOOTERS = {
  bypassPermissions: '⏵⏵ bypass permissions on (shift+tab to cycle)',
  acceptEdits: '⏵⏵ accept edits on (shift+tab to cycle)',
  plan: '⏸ plan mode on (shift+tab to cycle)',
};

export function contextPercent(tokens, total) {
  const t = Number(tokens);
  const w = Number(total);
  if (!(t > 0) || !(w > 0)) return 0;
  return Math.min(100, Math.floor((t * 100) / w));
}

export function contextBar(pct) {
  const filled = Math.min(10, Math.max(0, Math.floor(Number(pct) / 10) || 0));
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

export function contextTier(pct) {
  if (pct < 30) return 'green';
  if (pct < 50) return 'yellow';
  if (pct < 75) return 'orange';
  return 'red';
}

export function formatWindowSize(n) {
  return n >= 1000000 ? `${Math.floor(n / 1000000)}M` : `${Math.floor(n / 1000)}k`;
}

export function formatDuration(ms) {
  const secs = Math.max(0, Math.floor(Number(ms) / 1000) || 0);
  if (secs >= 3600) {
    const minutes = Math.floor((secs % 3600) / 60);
    return `${Math.floor(secs / 3600)}h ${String(minutes).padStart(2, '0')}m`;
  }
  if (secs >= 60) return `${Math.floor(secs / 60)}m`;
  return `${secs}s`;
}

function formatPick(override, value, fallback) {
  if (override !== null && override !== undefined && override !== '') return override;
  if (value !== null && value !== undefined && value !== '') return value;
  return fallback;
}

export function statusParts(meta, config, live) {
  const m = meta || {};
  const s = (config && config.status) || {};
  const l = live || {};
  const contextSize = s.contextWindow;
  const pct = contextPercent(l.contextTokens, contextSize);
  return {
    project: formatPick(s.project, m.project, ''),
    branch: formatPick(s.branch, m.branch, 'N/A'),
    model: formatPick(s.model, m.model, ''),
    effort: formatPick(s.effort, m.effort, null),
    bar: contextBar(pct),
    pct,
    tier: contextTier(pct),
    size: formatWindowSize(contextSize),
    duration: formatDuration(l.sessionMs),
    compactions: s.compactions,
  };
}

export function headerLines(meta, config) {
  const m = meta || {};
  const billing = config && config.header ? config.header.billing : null;
  const version = m.claudeVersion ? `Claude Code v${m.claudeVersion}` : 'Claude Code';
  const model = m.model || 'Claude';
  let second = m.effort ? `${model} with ${m.effort} effort` : model;
  if (billing) second += ` · ${billing}`;
  const third = `${m.agent ? `@${m.agent} · ` : ''}${m.cwd || ''}`;
  return [version, second, third];
}

export function footerText(permissionMode) {
  return FORMAT_FOOTERS[permissionMode] || '? for shortcuts';
}

export function toolLabel(event) {
  return `${event.name}(${event.summary === undefined || event.summary === null ? '' : event.summary})`;
}

function formatSpans(text) {
  const spans = [];
  const pattern = /`([^`\n]+)`|\*\*([^\n]+?)\*\*/g;
  let last = 0;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) spans.push({ kind: 'text', text: text.slice(last, match.index) });
    spans.push(match[1] !== undefined ? { kind: 'code', text: match[1] } : { kind: 'bold', text: match[2] });
    last = pattern.lastIndex;
  }
  if (last < text.length) spans.push({ kind: 'text', text: text.slice(last) });
  return spans;
}

export function parseMarkdownLite(text) {
  const lines = String(text === undefined || text === null ? '' : text).split(/\r?\n/);
  const blocks = [];
  let para = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: 'para', spans: formatSpans(para.join('\n')) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = /^\s*```(\S*)\s*$/.exec(line);
    if (fence) {
      flush();
      const body = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) body.push(lines[i++]);
      blocks.push({ kind: 'code', lang: fence[1], text: body.join('\n') });
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: 'heading', level: heading[1].length, spans: formatSpans(heading[2]) });
      continue;
    }
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      flush();
      blocks.push({ kind: 'bullet', spans: formatSpans(bullet[1]) });
      continue;
    }
    if (line.trim() === '') flush();
    else para.push(line);
  }
  flush();
  return blocks;
}
