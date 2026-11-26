import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  contextPercent,
  contextBar,
  contextTier,
  formatWindowSize,
  formatDuration,
  statusParts,
  headerLines,
  footerText,
  toolLabel,
  toolGroupKey,
  toolGroupLabel,
  parseMarkdownLite,
} from '../src/player/format.js';
import { normalizeConfig } from '../src/player/config.js';

test('contextPercent floors and caps', () => {
  assert.equal(contextPercent(42002, 1000000), 4);
  assert.equal(contextPercent(2000000, 1000000), 100);
  assert.equal(contextPercent(undefined, 1000000), 0);
});

test('contextBar has 10 segments', () => {
  assert.equal(contextBar(4), '░░░░░░░░░░');
  assert.equal(contextBar(42), '████░░░░░░');
  assert.equal(contextBar(100), '██████████');
});

test('contextTier boundaries', () => {
  const tiers = [29, 30, 49, 50, 74, 75].map(contextTier);
  assert.deepEqual(tiers, ['green', 'yellow', 'yellow', 'orange', 'orange', 'red']);
});

test('formatWindowSize', () => {
  assert.equal(formatWindowSize(1000000), '1M');
  assert.equal(formatWindowSize(200000), '200k');
});

test('formatDuration', () => {
  assert.equal(formatDuration(59000), '59s');
  assert.equal(formatDuration(61000), '1m');
  assert.equal(formatDuration(3720000), '1h 02m');
});

test('statusParts uses meta and config overrides', () => {
  const meta = { project: 'demo-app', branch: null, model: 'Sonnet 5.5', effort: 'high' };
  const parts = statusParts(meta, normalizeConfig({}), { contextTokens: 42002, sessionMs: 8000 });
  assert.deepEqual(parts, {
    project: 'demo-app',
    branch: 'N/A',
    model: 'Sonnet 5.5',
    effort: 'high',
    bar: '░░░░░░░░░░',
    pct: 4,
    tier: 'green',
    size: '1M',
    duration: '8s',
    compactions: 0,
  });
  const over = statusParts(meta, normalizeConfig({ status: { branch: 'dev', model: 'X' } }), {});
  assert.equal(over.branch, 'dev');
  assert.equal(over.model, 'X');
});

test('headerLines', () => {
  const meta = { claudeVersion: '2.1.308', model: 'Sonnet 5.5', effort: 'high', agent: 'orchestrator', cwd: '~/Projects/demo-app' };
  assert.deepEqual(headerLines(meta, normalizeConfig({})), [
    'Claude Code v2.1.308',
    'Sonnet 5.5 with high effort',
    '@orchestrator · ~/Projects/demo-app',
  ]);
  const billed = headerLines({ ...meta, agent: null }, normalizeConfig({ header: { billing: 'API Usage Billing' } }));
  assert.equal(billed[1], 'Sonnet 5.5 with high effort · API Usage Billing');
  assert.equal(billed[2], '~/Projects/demo-app');
});

test('footerText', () => {
  assert.equal(footerText('bypassPermissions'), '⏵⏵ bypass permissions on (shift+tab to cycle)');
  assert.equal(footerText('acceptEdits'), '⏵⏵ accept edits on (shift+tab to cycle)');
  assert.equal(footerText('plan'), '⏸ plan mode on (shift+tab to cycle)');
  assert.equal(footerText('default'), '? for shortcuts');
  assert.equal(footerText(null), '? for shortcuts');
});

test('toolLabel', () => {
  assert.equal(toolLabel({ name: 'Bash', summary: 'npm test' }), 'Bash(npm test)');
});

test('toolGroupKey', () => {
  assert.equal(toolGroupKey('Read'), 'Read');
  assert.equal(toolGroupKey('mcp__github__get_issue'), 'mcp__github');
  assert.equal(toolGroupKey('mcp__ccd_session_mgmt__list_sessions'), 'mcp__ccd_session_mgmt');
  assert.equal(toolGroupKey('mcp__scheduled-tasks__list_scheduled_tasks'), 'mcp__scheduled-tasks');
  assert.equal(toolGroupKey('mcp__bad'), 'mcp__bad');
});

test('toolGroupLabel', () => {
  assert.equal(toolGroupLabel('Read', 3), 'Read 3 files');
  assert.equal(toolGroupLabel('Read', 1), 'Read 1 file');
  assert.equal(toolGroupLabel('Grep', 2), 'Searched for 2 patterns');
  assert.equal(toolGroupLabel('Glob', 1), 'Searched for 1 pattern');
  assert.equal(toolGroupLabel('mcp__github__get_issue', 2), 'Called github 2 times');
  assert.equal(toolGroupLabel('Bash', 3), 'Called Bash 3 times');
});

test('parseMarkdownLite inline spans', () => {
  assert.deepEqual(parseMarkdownLite('**b** and `c`'), [
    {
      kind: 'para',
      spans: [
        { kind: 'bold', text: 'b' },
        { kind: 'text', text: ' and ' },
        { kind: 'code', text: 'c' },
      ],
    },
  ]);
});

test('parseMarkdownLite fenced code block', () => {
  const blocks = parseMarkdownLite('```js\nconst a = 1;\n\nconst b = 2;\n```');
  assert.deepEqual(blocks, [{ kind: 'code', lang: 'js', text: 'const a = 1;\n\nconst b = 2;' }]);
});

test('parseMarkdownLite headings bullets paragraphs', () => {
  const blocks = parseMarkdownLite('## Title\n\n- one\n- two **x**\n\nfirst\nsecond');
  assert.deepEqual(
    blocks.map((b) => b.kind),
    ['heading', 'bullet', 'bullet', 'para'],
  );
  assert.equal(blocks[0].level, 2);
  assert.deepEqual(blocks[3].spans, [{ kind: 'text', text: 'first\nsecond' }]);
});
