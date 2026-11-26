import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { buildSchedule, validateTimeline } from '../src/player/schedule.js';
import { DEFAULT_CONFIG, normalizeConfig } from '../src/player/config.js';

const groupedFixture = JSON.parse(readFileSync(new URL('./fixtures/grouped-timeline.json', import.meta.url), 'utf8'));
const sampleTimeline = JSON.parse(readFileSync(new URL('../showcases/sample/timeline.json', import.meta.url), 'utf8'));

function timeline(events) {
  return { version: 1, meta: {}, events };
}

function thinking(durationMs, turn = 1) {
  return { type: 'thinking', t: 0, turn, durationMs };
}

function prompt(text, turn = 1) {
  return { type: 'prompt', t: 0, turn, text };
}

test('deterministic for same seed', () => {
  const tl = timeline([prompt('Add a --version flag, then run the tests.')]);
  const a = buildSchedule(tl, { seed: 7 });
  const b = buildSchedule(tl, { seed: 7 });
  const c = buildSchedule(tl, { seed: 8 });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.segments[0].charTimes, c.segments[0].charTimes);
});

test('thinking clamped', () => {
  const long = buildSchedule(timeline([thinking(60000)]), {});
  const short = buildSchedule(timeline([thinking(100)]), {});
  assert.equal(long.segments[0].kind, 'think');
  assert.equal(long.segments[0].end - long.segments[0].start, 4000);
  assert.equal(short.segments[0].end - short.segments[0].start, 800);
});

test('typing capped at maxMs', () => {
  const text = 'x'.repeat(1000);
  const { segments } = buildSchedule(timeline([prompt(text)]), { typing: { cps: 28, maxMs: 6000 } });
  const typed = segments[0];
  assert.equal(typed.kind, 'type');
  assert.ok(typed.end - typed.start <= 6000);
  assert.equal(typed.charTimes.length, 1000);
  for (let i = 1; i < typed.charTimes.length; i++) assert.ok(typed.charTimes[i] >= typed.charTimes[i - 1]);
  assert.ok(typed.charTimes[999] <= typed.end - typed.start);
  assert.equal(segments[1].kind, 'submit');
  assert.equal(segments[1].start, segments[1].end);
});

test('multipliers scale durations', () => {
  const doubled = buildSchedule(timeline([thinking(60000)]), { thinking: { multiplier: 2 } });
  assert.equal(doubled.segments[0].end - doubled.segments[0].start, 8000);
  const text = { type: 'text', t: 0, turn: 1, text: 'y'.repeat(600) };
  const base = buildSchedule(timeline([text]), {});
  const slow = buildSchedule(timeline([text]), { output: { multiplier: 2 } });
  assert.equal(base.segments[0].end, 1000);
  assert.equal(slow.segments[0].end, 2000);
  const typed = timeline([prompt('hello world')]);
  const t1 = buildSchedule(typed, {}).segments[0].end;
  const t2 = buildSchedule(typed, { typing: { multiplier: 2 } }).segments[0].end;
  assert.ok(Math.abs(t2 - 2 * t1) <= 1);
});

test('tool wait clamped', () => {
  const tool = (durationMs) => ({ type: 'tool_use', t: 0, turn: 1, id: 't1', name: 'Bash', summary: 'x', durationMs });
  const wait = (ms) => {
    const segment = buildSchedule(timeline([tool(ms)]), {}).segments[0];
    return segment.end - segment.start;
  };
  assert.equal(wait(100000), 3000);
  assert.equal(wait(0), 400);
  assert.equal(wait(8000), 2000);
  const none = buildSchedule(timeline([{ type: 'tool_use', t: 0, turn: 1, id: 't1', name: 'Bash', summary: 'x' }]), {});
  assert.equal(none.segments[0].end, 400);
});

test('turn range', () => {
  const tl = timeline([prompt('one', 1), thinking(1000, 1), prompt('two', 2), thinking(1000, 2), prompt('three', 3)]);
  const { segments } = buildSchedule(tl, { turns: [2, 2] });
  assert.ok(segments.length > 0);
  assert.ok(segments.every((s) => s.turn === 2));
  assert.deepEqual([...new Set(segments.map((s) => s.eventIndex))], [2, 3]);
  assert.equal(segments[0].start, 0);
});

test('results hidden', () => {
  const tl = timeline([
    { type: 'tool_use', t: 0, turn: 1, id: 't1', name: 'Bash', summary: 'x' },
    { type: 'tool_result', t: 10, turn: 1, toolUseId: 't1', isError: false, lines: ['ok'], totalLines: 1 },
  ]);
  const shown = buildSchedule(tl, {});
  const hidden = buildSchedule(tl, { results: { show: false } });
  assert.deepEqual(shown.segments.map((s) => s.kind), ['tool', 'result']);
  assert.deepEqual(hidden.segments.map((s) => s.kind), ['tool']);
});

test('totalMs is last end', () => {
  const tl = timeline([
    prompt('hi'),
    { type: 'thinking', t: 100, turn: 1, durationMs: 2000, contextTokens: 42002 },
    { type: 'text', t: 200, turn: 1, text: 'done' },
  ]);
  const { totalMs, segments } = buildSchedule(tl, {});
  assert.equal(totalMs, Math.max(...segments.map((s) => s.end)));
  assert.equal(totalMs, segments[segments.length - 1].end);
  assert.deepEqual(segments.map((s) => s.kind), ['type', 'submit', 'think', 'stream']);
  assert.equal(segments[2].contextTokens, 42002);
  assert.equal(segments[2].sessionMs, 100);
  assert.equal(segments[0].contextTokens, undefined);
  for (let i = 1; i < segments.length; i++) assert.ok(segments[i].start >= segments[i - 1].end);
  assert.equal(buildSchedule(timeline([]), {}).totalMs, 0);
});

test('invalid timeline rejected', () => {
  assert.throws(() => validateTimeline({ version: 2, events: [] }), /version/);
  assert.throws(() => validateTimeline({ version: 1, events: {} }), /events/);
  assert.throws(() => validateTimeline({ version: 1, events: [{ type: 'bogus' }] }), /events\[0\]\.type/);
  assert.throws(() => validateTimeline(null), /timeline/);
  assert.doesNotThrow(() => validateTimeline({ version: 1, events: [{ type: 'text', text: 'a' }] }));
});

test('normalizeConfig defaults and clamps', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
  assert.deepEqual(normalizeConfig({}), DEFAULT_CONFIG);
  assert.equal(normalizeConfig({ speed: 'abc' }).speed, 1);
  assert.equal(normalizeConfig({ speed: 100 }).speed, 20);
  assert.equal(normalizeConfig({ speed: 0 }).speed, 0.1);
  assert.equal(normalizeConfig({ speed: NaN }).speed, 1);
  assert.equal(normalizeConfig({ typing: { jitter: 5 } }).typing.jitter, 0.9);
  assert.equal(normalizeConfig({ typing: { cps: -5 } }).typing.cps, 1);
  assert.equal(normalizeConfig({ typing: { cps: 50 } }).typing.maxMs, 6000);
  assert.equal(normalizeConfig({ columns: 10 }).columns, 40);
  assert.equal(normalizeConfig({ theme: 'neon' }).theme, 'dark');
  assert.equal(normalizeConfig({ fit: 'width' }).fit, 'width');
  assert.equal(normalizeConfig({ width: 'calc(1px)' }).width, '100%');
  assert.equal(normalizeConfig({ results: { lines: 99 } }).results.lines, 50);
  assert.equal(normalizeConfig({ loop: 'yes' }).loop, false);
  assert.deepEqual(normalizeConfig({ turns: [2, 3] }).turns, [2, 3]);
  assert.equal(normalizeConfig({ turns: [3, 2] }).turns, null);
  assert.equal(normalizeConfig({ header: { billing: 'API Usage Billing' } }).header.billing, 'API Usage Billing');
  assert.equal(normalizeConfig({ unknown: 1 }).unknown, undefined);
  assert.equal(normalizeConfig({ typing: { unknown: 1 } }).typing.unknown, undefined);
  assert.equal(normalizeConfig({ typing: 5 }).typing.cps, 28);
  assert.doesNotThrow(() => normalizeConfig('junk'));
  assert.ok(Object.isFrozen(DEFAULT_CONFIG));
  assert.ok(Object.isFrozen(DEFAULT_CONFIG.typing));
});

test('normalizeConfig tool.combine', () => {
  assert.equal(DEFAULT_CONFIG.tool.combine, true);
  assert.equal(normalizeConfig({}).tool.combine, true);
  assert.equal(normalizeConfig({ tool: { combine: false } }).tool.combine, false);
  assert.equal(normalizeConfig({ tool: { combine: 'false' } }).tool.combine, true);
});

test('combine groups consecutive same tool calls', () => {
  assert.doesNotThrow(() => validateTimeline(groupedFixture));
  const { segments } = buildSchedule(groupedFixture, {});
  assert.deepEqual(
    segments.map((s) => s.kind),
    ['type', 'submit', 'tool', 'tool', 'tool', 'tool', 'tool', 'stream', 'tool', 'tool', 'tool', 'result', 'tool', 'result'],
  );
  assert.deepEqual(segments.map((s) => s.eventIndex), [0, 0, 1, 3, 5, 7, 9, 11, 12, 14, 16, 17, 18, 19]);
  const groupOf = (index) => segments.find((s) => s.kind === 'tool' && s.eventIndex === index).group;
  assert.deepEqual(groupOf(1), { first: 1, position: 1, size: 3 });
  assert.deepEqual(groupOf(3), { first: 1, position: 2, size: 3 });
  assert.deepEqual(groupOf(5), { first: 1, position: 3, size: 3 });
  assert.deepEqual(groupOf(7), { first: 7, position: 1, size: 2 });
  assert.deepEqual(groupOf(9), { first: 7, position: 2, size: 2 });
  assert.deepEqual(groupOf(12), { first: 12, position: 1, size: 2 });
  assert.deepEqual(groupOf(14), { first: 12, position: 2, size: 2 });
  assert.equal('group' in segments.find((s) => s.eventIndex === 16), false);
  assert.equal('group' in segments.find((s) => s.eventIndex === 18), false);
  const hidden = buildSchedule(groupedFixture, { results: { show: false } }).segments;
  assert.equal(hidden.some((s) => s.kind === 'result'), false);
  assert.deepEqual(
    hidden.filter((s) => s.kind === 'tool').map((s) => s.group),
    segments.filter((s) => s.kind === 'tool').map((s) => s.group),
  );
});

test('combine breaks on thinking and text', () => {
  const read = (id) => ({ type: 'tool_use', t: 0, turn: 1, id, name: 'Read', summary: 'x' });
  const done = (id) => ({ type: 'tool_result', t: 0, turn: 1, toolUseId: id, isError: false, lines: ['ok'], totalLines: 1 });
  const tl = timeline([
    read('t1'),
    done('t1'),
    thinking(1000),
    read('t2'),
    done('t2'),
    { type: 'text', t: 0, turn: 1, text: 'hi' },
    read('t3'),
    done('t3'),
  ]);
  const { segments } = buildSchedule(tl, {});
  assert.equal(segments.some((s) => 'group' in s), false);
  assert.equal(segments.filter((s) => s.kind === 'result').length, 3);
});

test('combine off keeps every call', () => {
  const { segments } = buildSchedule(groupedFixture, { tool: { combine: false } });
  assert.equal(segments.length, 21);
  assert.equal(segments.filter((s) => s.kind === 'tool').length, 9);
  assert.equal(segments.filter((s) => s.kind === 'result').length, 9);
  assert.equal(segments.some((s) => 'group' in s), false);
});

test('combine leaves sample schedule unchanged', () => {
  assert.deepEqual(buildSchedule(sampleTimeline, {}), buildSchedule(sampleTimeline, { tool: { combine: false } }));
});
