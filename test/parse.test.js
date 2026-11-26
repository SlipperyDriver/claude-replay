import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseTranscript } from '../src/cli/parse.js';

const fixture = readFileSync(new URL('./fixtures/session.jsonl', import.meta.url), 'utf8');

test('event sequence from fixture', () => {
  const { timeline, stats } = parseTranscript(fixture);
  assert.deepEqual(
    timeline.events.map((event) => event.type),
    ['prompt', 'thinking', 'text', 'tool_use', 'tool_result', 'tool_use', 'tool_result', 'tool_use', 'tool_result', 'text', 'prompt', 'tool_use', 'tool_result', 'text'],
  );
  assert.equal(timeline.version, 1);
  assert.equal(timeline.events[0].text, 'Add a --version flag to the CLI and run the tests');
  assert.equal(timeline.events[0].t, 0);
  assert.equal(timeline.meta.durationMs, timeline.events.at(-1).t);
  for (let i = 1; i < timeline.events.length; i += 1) {
    assert.ok(timeline.events[i].t >= timeline.events[i - 1].t);
  }
  assert.deepEqual(
    timeline.events.map((event) => event.turn),
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2],
  );
  assert.equal(stats.events, 14);
  assert.equal(stats.turns, 2);
  assert.equal(stats.skippedLines, 0);
  assert.ok(!JSON.stringify(timeline).includes('subagent noise'));
});

test('meta from fixture', () => {
  const { meta } = parseTranscript(fixture).timeline;
  assert.deepEqual(
    {
      agent: meta.agent,
      permissionMode: meta.permissionMode,
      model: meta.model,
      modelId: meta.modelId,
      effort: meta.effort,
      claudeVersion: meta.claudeVersion,
      cwd: meta.cwd,
      project: meta.project,
      branch: meta.branch,
      isWorktree: meta.isWorktree,
    },
    {
      agent: 'orchestrator',
      permissionMode: 'bypassPermissions',
      model: 'Sonnet 5.5',
      modelId: 'claude-sonnet-5-5',
      effort: 'high',
      claudeVersion: '2.1.308',
      cwd: '~/Projects/demo-app',
      project: 'demo-app',
      branch: 'main',
      isWorktree: false,
    },
  );
  assert.equal(meta.title, null);
  assert.equal(parseTranscript(fixture, { title: 'My title' }).timeline.meta.title, 'My title');
});

test('tool summaries and results', () => {
  const { events } = parseTranscript(fixture).timeline;
  const uses = events.filter((event) => event.type === 'tool_use');
  const results = events.filter((event) => event.type === 'tool_result');
  assert.deepEqual(
    uses.map((event) => [event.id, event.name, event.summary]),
    [
      ['t1', 'Read', '~/Projects/demo-app/bin/cli.js'],
      ['t2', 'Edit', '~/Projects/demo-app/bin/cli.js'],
      ['t3', 'Bash', 'npm test'],
      ['t4', 'Agent', 'planner: Outline release steps'],
    ],
  );
  assert.deepEqual(
    results.map((event) => event.toolUseId),
    ['t1', 't2', 't3', 't4'],
  );
  assert.equal(results[0].lines.length, 20);
  assert.equal(results[0].totalLines, 30);
  assert.equal(results[0].isError, false);
  assert.equal(results[1].lines[0], 'The file ~/Projects/demo-app/bin/cli.js has been updated successfully.');
  assert.equal(uses[2].durationMs, 8000);
  assert.equal(results[2].totalLines, 5);
  assert.deepEqual(results[3].lines, ['Running in background']);
  assert.equal(parseTranscript(fixture, { maxResultLines: 5 }).timeline.events[4].lines.length, 5);
});

test('thinking text dropped by default', () => {
  const thinking = parseTranscript(fixture).timeline.events[1];
  assert.equal(thinking.type, 'thinking');
  assert.equal(thinking.durationMs, 5200);
  assert.equal(thinking.contextTokens, 42002);
  assert.ok(!('text' in thinking));
  assert.ok(!JSON.stringify(thinking).includes('Need to find'));
});

test('thinking text kept with option', () => {
  const thinking = parseTranscript(fixture, { thinkingText: true }).timeline.events[1];
  assert.equal(thinking.text, 'Need to find the CLI entry first.');
  assert.equal(thinking.durationMs, 5200);
});

test('turn range filter', () => {
  const { timeline, stats } = parseTranscript(fixture, { turns: [2, 2] });
  assert.equal(timeline.events.length, 4);
  assert.deepEqual(
    timeline.events.map((event) => event.type),
    ['prompt', 'tool_use', 'tool_result', 'text'],
  );
  assert.ok(timeline.events.every((event) => event.turn === 2));
  assert.equal(timeline.events[0].t, 0);
  assert.equal(timeline.meta.durationMs, timeline.events.at(-1).t);
  assert.equal(stats.turns, 1);
});

test('home paths redacted', () => {
  const { timeline, stats } = parseTranscript(fixture);
  const json = JSON.stringify(timeline);
  assert.ok(!json.includes('/Users/'));
  assert.ok(!json.includes('example/Projects'));
  assert.ok(stats.redactions > 0);
  const custom = parseTranscript(fixture, { extraPatterns: [/planner/] });
  assert.ok(!JSON.stringify(custom.timeline).includes('planner'));
  assert.ok(custom.stats.redactions > stats.redactions);
});

test('malformed lines counted', () => {
  const broken = `not json\n${fixture}{"type":"user"\n[1,2]\n\n`;
  const { timeline, stats } = parseTranscript(broken);
  assert.equal(stats.skippedLines, 3);
  assert.equal(timeline.events.length, 14);
});
