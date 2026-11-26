import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const entry = new URL('../bin/claude-replay.js', import.meta.url).pathname;
const fixture = new URL('./fixtures/session.jsonl', import.meta.url).pathname;

function run(args) {
  return spawnSync(process.execPath, [entry, ...args], { encoding: 'utf8' });
}

function makeTimeline(dir) {
  const path = join(dir, 'timeline.json');
  const result = run(['parse', fixture, '-o', path]);
  assert.equal(result.status, 0, result.stderr);
  return path;
}

function makeBundle(dir, timelinePath, name = 'out.html') {
  const out = join(dir, name);
  const result = run(['bundle', timelinePath, '-o', out, '--title', 'demo <&> "x"']);
  assert.equal(result.status, 0, result.stderr);
  return readFileSync(out, 'utf8');
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'claude-replay-bundle-'));
  return { dir, timelinePath: makeTimeline(dir) };
}

function moduleCode(html) {
  const match = /<script type="module">\n([\s\S]*)\n<\/script>/.exec(html);
  assert.ok(match, 'module script present');
  return match[1];
}

test('bundle is self-contained', () => {
  const { dir, timelinePath } = setup();
  const html = makeBundle(dir, timelinePath);
  assert.ok(html.startsWith('<!doctype html>'));
  assert.doesNotMatch(html, /\bsrc=/);
  assert.doesNotMatch(html, /\bhref=/);
  assert.doesNotMatch(html, /^(import|export) /m);
  assert.match(html, /<title>demo &lt;&amp;&gt; &quot;x&quot;<\/title>/);
  assert.match(html, /<claude-replay config='\{\}'>/);
  assert.match(html, /<script type="application\/json" data-timeline>/);
});

test('bundle escapes script close', () => {
  const { dir, timelinePath } = setup();
  const timeline = JSON.parse(readFileSync(timelinePath, 'utf8'));
  timeline.events[0].text = 'x </script><b>y</b>';
  writeFileSync(timelinePath, JSON.stringify(timeline));
  const html = makeBundle(dir, timelinePath);
  const start = html.indexOf('data-timeline>') + 'data-timeline>'.length;
  const end = html.indexOf('</script>', start);
  const block = html.slice(start, end);
  assert.ok(!block.includes('</script>'));
  assert.ok(block.includes('\\u003c/script>'));
  assert.equal(JSON.parse(block).events[0].text, 'x </script><b>y</b>');
});

test('bundle script parses', () => {
  const { dir, timelinePath } = setup();
  const html = makeBundle(dir, timelinePath);
  const file = join(dir, 'bundle.mjs');
  writeFileSync(file, moduleCode(html));
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('bundle deterministic', () => {
  const { dir, timelinePath } = setup();
  const first = makeBundle(dir, timelinePath, 'a.html');
  const second = makeBundle(dir, timelinePath, 'b.html');
  assert.equal(first, second);
});
