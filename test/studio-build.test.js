import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildStudioHtml } from '../src/cli/build-studio.js';
import { buildShowcaseHtml } from '../src/cli/bundle.js';
import { normalizeConfig } from '../src/player/config.js';

const entry = new URL('../bin/claude-replay.js', import.meta.url).pathname;
const root = new URL('../', import.meta.url).pathname;
const PLAYER_NAMES = ['config', 'format', 'schedule', 'styles', 'claude-replay'];

const SHELL = [
  '<head>',
  '<meta charset="utf-8">',
  '</head>',
  '<body>',
  '<claude-replay id="player" src="../showcases/sample/timeline.json"></claude-replay>',
  '<script type="module" src="./demo.js"></script>',
  '</body>',
].join('\n');

function build(shellHtml, overrides = {}) {
  return buildStudioHtml({
    shellHtml,
    sampleTimeline: { version: 1, events: [] },
    playerSources: ['export const A = 1;'],
    appSources: ["import { A } from './a.js';\nconst B = '</script>';"],
    ...overrides,
  });
}

function count(text, needle) {
  return text.split(needle).length - 1;
}

test('studio shell markers required', () => {
  const noScript = SHELL.replace('<script type="module" src="./demo.js"></script>', '');
  assert.throws(() => build(noScript), /expected exactly one/);
  const sampleMarker = ' src="../showcases/sample/timeline.json"></claude-replay>';
  const twice = `${SHELL}\n<claude-replay${sampleMarker}`;
  assert.throws(() => build(twice), /expected exactly one/);
});

test('studio build output', () => {
  const playerSources = ['export const A = 1;'];
  const html = build(SHELL, { playerSources });
  assert.ok(html.includes('const A = 1;'));
  assert.ok(html.includes("'<\\/script>'"));
  assert.ok(html.includes('Content-Security-Policy'));
  assert.doesNotMatch(html, /^(import|export) /m);
  const marker = 'id="player-sources">';
  const start = html.indexOf(marker) + marker.length;
  const end = html.indexOf('</script>', start);
  assert.deepEqual(JSON.parse(html.slice(start, end)), playerSources);
  assert.equal(count(html, '</script>'), 3);
  assert.equal(count(html, '<script'), 3);
});

test('studio usage error exits 2', () => {
  const dir = mkdtempSync(join(tmpdir(), 'claude-replay-studio-'));
  for (const args of [['studio'], ['studio', 'x', '-o', join(dir, 's.html')]]) {
    const result = spawnSync(process.execPath, [entry, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Usage:/);
  }
});

function markup(html) {
  return html.replace(/(<script[^>]*>)[\s\S]*?(<\/script>)/g, '$1$2');
}

function moduleCode(html) {
  const open = '<script type="module">\n';
  const start = html.indexOf(open);
  assert.ok(start >= 0, 'module script present');
  const from = start + open.length;
  const end = html.indexOf('\n</script>', from);
  assert.ok(end >= 0, 'module script closed');
  return html.slice(from, end);
}

function artifact() {
  return readFileSync(join(root, 'claude-replay-studio.html'), 'utf8');
}

test('studio artifact is regenerable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'claude-replay-studio-'));
  const out = join(dir, 'studio.html');
  const result = spawnSync(process.execPath, [entry, 'studio', '-o', out], { encoding: 'utf8', cwd: root });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(readFileSync(out).equals(readFileSync(join(root, 'claude-replay-studio.html'))));
});

test('studio artifact is self-contained', () => {
  const html = artifact();
  const shell = markup(html);
  assert.doesNotMatch(shell, /\b(src|href)=/);
  assert.doesNotMatch(shell, /<link\b/);
  assert.doesNotMatch(shell, /<(iframe|img)\b/);
  assert.equal(count(html.replace(moduleCode(html), ''), '<script'), 3);
  assert.equal(count(html, '</script>'), 3);
  assert.doesNotMatch(moduleCode(html), /<!--/);
  for (const url of html.match(/https?:\/\/[^\s'"`)\\]+/g) || []) {
    assert.equal(url, 'http://www.w3.org/2000/svg');
  }
  assert.ok(html.includes('Content-Security-Policy'));
  assert.ok(html.includes('id="player-sources"'));
  assert.ok(html.includes('data-timeline'));
});

test('studio artifact has no network calls', () => {
  const code = moduleCode(artifact());
  assert.equal(count(code, 'fetch('), 1);
  assert.ok(code.includes('fetch(src)'));
  assert.doesNotMatch(code, /XMLHttpRequest|WebSocket|sendBeacon|EventSource|\bimport\(/);
});

test('studio artifact script parses', () => {
  const code = moduleCode(artifact());
  assert.doesNotMatch(code, /^(import|export) /m);
  const dir = mkdtempSync(join(tmpdir(), 'claude-replay-studio-'));
  const file = join(dir, 'studio.mjs');
  writeFileSync(file, code);
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('studio export matches CLI bundle', () => {
  const html = artifact();
  const marker = 'id="player-sources">';
  const start = html.indexOf(marker) + marker.length;
  const playerSources = JSON.parse(html.slice(start, html.indexOf('</script>', start)));
  const expected = PLAYER_NAMES.map((name) => readFileSync(join(root, 'src/player', `${name}.js`), 'utf8'));
  assert.deepEqual(playerSources, expected);
  const dir = mkdtempSync(join(tmpdir(), 'claude-replay-studio-'));
  const sampleText = readFileSync(join(root, 'showcases/sample/timeline.json'), 'utf8');
  const config = normalizeConfig({ theme: 'light', speed: 2 });
  const cfgPath = join(dir, 'cfg.json');
  writeFileSync(cfgPath, JSON.stringify(config));
  const result = buildShowcaseHtml({
    timeline: JSON.parse(sampleText),
    config,
    title: 'claude-replay sample',
    playerSources,
  });
  const out = join(dir, 'out.html');
  const run = spawnSync(
    process.execPath,
    [entry, 'bundle', join(root, 'showcases/sample/timeline.json'), '-o', out, '--config', cfgPath, '--title', 'claude-replay sample'],
    { encoding: 'utf8', cwd: root },
  );
  assert.equal(run.status, 0, run.stderr);
  assert.equal(result, readFileSync(out, 'utf8'));
  assert.ok(result.includes('&quot;theme&quot;:&quot;light&quot;'));
  assert.ok(result.includes('data-timeline'));
  assert.doesNotMatch(markup(result), /\b(src|href)=|<link\b/);
});
