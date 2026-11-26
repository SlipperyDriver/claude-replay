import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { File } from 'node:buffer';
import { readInputFile, timelineFromInput, exportFileName, embedSnippet } from '../src/studio/studio.js';
import { normalizeConfig } from '../src/player/config.js';

const fixtureText = readFileSync(new URL('./fixtures/session.jsonl', import.meta.url), 'utf8');
const sampleText = readFileSync(new URL('../showcases/sample/timeline.json', import.meta.url), 'utf8');
const sample = JSON.parse(sampleText);

function transcriptInput(text, name = 'session.jsonl') {
  return readInputFile(new File([text], name));
}

test('studio parses fixture like the CLI', async () => {
  const input = await transcriptInput(fixtureText);
  const { timeline, stats } = timelineFromInput(input, { title: 'claude-replay sample' });
  assert.equal(input.kind, 'transcript');
  assert.deepEqual(timeline, sample);
  assert.equal(stats.events, 14);
  assert.ok(stats.redactions > 0);
});

test('studio loads timeline json', async () => {
  const input = await readInputFile(new File([sampleText], 'timeline.json'));
  const { timeline, stats } = timelineFromInput(input);
  assert.equal(input.kind, 'timeline');
  assert.deepEqual(timeline, sample);
  assert.equal(stats, null);
});

test('studio rejects invalid timeline', async () => {
  const wrongVersion = await readInputFile(new File(['{"version":2,"events":[]}'], 'x.json'));
  assert.throws(() => timelineFromInput(wrongVersion));
  const notJson = await readInputFile(new File(['not json'], 'x.json'));
  assert.throws(() => timelineFromInput(notJson), /not valid JSON/);
});

test('studio parser options', async () => {
  const input = await transcriptInput(fixtureText);

  const turn2 = timelineFromInput(input, { turnsFrom: '2', turnsTo: '2' }).timeline;
  assert.equal(turn2.events.length, 4);
  assert.ok(turn2.events.every((event) => event.turn === 2));

  const withThinking = timelineFromInput(input, { thinkingText: true }).timeline;
  assert.equal(withThinking.events.find((event) => event.type === 'thinking').text, 'Need to find the CLI entry first.');
  const withoutThinking = timelineFromInput(input, {}).timeline;
  assert.equal('text' in withoutThinking.events.find((event) => event.type === 'thinking'), false);

  const limited = timelineFromInput(input, { maxResultLines: '5' }).timeline;
  const firstResult = limited.events.find((event) => event.type === 'tool_result');
  assert.equal(firstResult.lines.length, 5);
  assert.equal(firstResult.totalLines, 30);

  const redacted = timelineFromInput(input, { redact: 'demo-app\n' }).timeline;
  assert.ok(!JSON.stringify(redacted).includes('demo-app'));
});

test('studio rejects bad parser options', async () => {
  const input = await transcriptInput(fixtureText);
  assert.throws(() => timelineFromInput(input, { redact: '(' }), /bad redact pattern/);
  assert.throws(() => timelineFromInput(input, { turnsFrom: '3', turnsTo: '2' }), /bad turn range/);
  assert.throws(() => timelineFromInput(input, { turnsFrom: '1' }), /bad turn range/);
  assert.throws(() => timelineFromInput(input, { maxResultLines: '-1' }), /bad max result lines/);
});

test('studio redacts transcript username', async () => {
  const line = (cwd, name) =>
    JSON.stringify({
      type: 'user',
      timestamp: '2026-01-01T00:00:00.000Z',
      cwd,
      promptSource: 'typed',
      origin: { kind: 'human' },
      message: { role: 'user', content: `ask ${name} about it` },
    });

  const alice = timelineFromInput(await transcriptInput(line('/Users/alice/proj', 'alice'))).timeline;
  assert.equal(alice.events[0].text, 'ask <user> about it');
  assert.equal(alice.meta.cwd, '~/proj');

  const bob = timelineFromInput(await transcriptInput(line('/home/bob/proj', 'bob'))).timeline;
  assert.equal(bob.events[0].text, 'ask <user> about it');
  assert.equal(bob.meta.cwd, '~/proj');
});

test('export file name', () => {
  assert.equal(exportFileName('My Demo: v2!'), 'my-demo-v2');
  assert.equal(exportFileName(''), 'showcase');
  assert.equal(exportFileName('日本'), 'showcase');
  assert.equal(exportFileName('a'.repeat(100)).length, 60);
});

test('embed snippet', () => {
  assert.equal(
    embedSnippet('my-demo.html', normalizeConfig({}), 'A "b"'),
    '<iframe src="my-demo.html" title="A &quot;b&quot;" style="width:100%;height:600px;border:0" loading="lazy"></iframe>',
  );
});
