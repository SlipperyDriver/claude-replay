import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const entry = new URL('../bin/claude-replay.js', import.meta.url).pathname;
const fixture = new URL('./fixtures/session.jsonl', import.meta.url).pathname;

function run(args) {
  return spawnSync(process.execPath, [entry, ...args], { encoding: 'utf8' });
}

function tmp() {
  return mkdtempSync(join(tmpdir(), 'claude-replay-cli-'));
}

test('parse writes timeline', () => {
  const out = join(tmp(), 'nested', 'timeline.json');
  const result = run(['parse', fixture, '-o', out, '--title', 'demo']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^wrote .+: 14 events, 2 turns, \d+ redactions\n$/);
  assert.match(result.stderr, /review output before publishing: redaction is pattern-based/);
  const raw = readFileSync(out, 'utf8');
  assert.ok(raw.endsWith('}\n'));
  const timeline = JSON.parse(raw);
  assert.equal(timeline.version, 1);
  assert.equal(timeline.meta.title, 'demo');
  assert.equal(timeline.events.length, 14);
});

test('parse turn range', () => {
  const out = join(tmp(), 'timeline.json');
  const result = run(['parse', fixture, '-o', out, '--turns', '2-2']);
  assert.equal(result.status, 0, result.stderr);
  const timeline = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(timeline.events.length, 4);
  assert.ok(timeline.events.every((event) => event.turn === 2));
});

test('usage error exits 2', () => {
  const out = join(tmp(), 'timeline.json');
  for (const args of [[], ['nope'], ['parse'], ['parse', fixture], ['parse', fixture, '-o', out, '--turns', 'x']]) {
    const result = run(args);
    assert.equal(result.status, 2, `args ${JSON.stringify(args)}: ${result.stderr}`);
    assert.match(result.stderr, /Usage:/);
  }
});

test('missing file exits 1', () => {
  const missing = join(tmp(), 'absent.jsonl');
  const result = run(['parse', missing, '-o', join(tmp(), 'timeline.json')]);
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes(missing));
});

const sampleDir = new URL('../showcases/sample/', import.meta.url).pathname;

test('sample timeline is regenerable', () => {
  const out = join(tmp(), 'timeline.json');
  const result = run(['parse', fixture, '-o', out, '--title', 'claude-replay sample']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    JSON.parse(readFileSync(out, 'utf8')),
    JSON.parse(readFileSync(join(sampleDir, 'timeline.json'), 'utf8')),
  );
});

test('sample bundle is regenerable', () => {
  const out = join(tmp(), 'index.html');
  const result = run(['bundle', join(sampleDir, 'timeline.json'), '-o', out, '--title', 'claude-replay sample']);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(readFileSync(out).equals(readFileSync(join(sampleDir, 'index.html'))));
});
