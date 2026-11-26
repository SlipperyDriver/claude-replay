import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactText, redactTimeline } from '../src/cli/redact.js';

test('rule 1: home paths become ~', () => {
  const input = 'open /Users/alice/proj/a.js and /home/bob/x and C:\\Users\\carol\\file';
  const result = redactText(input);
  assert.equal(result.value, 'open ~/proj/a.js and ~/x and ~\\file');
  assert.equal(result.count, 3);
});

test('rule 2: username becomes <user> on word boundaries', () => {
  const result = redactText('alice ran alicex for malice', { username: 'alice' });
  assert.equal(result.value, '<user> ran alicex for malice');
  assert.equal(result.count, 1);
  assert.equal(redactText('ab at ab', { username: 'ab' }).value, 'ab at ab');
});

test('rule 3: token patterns become <redacted>', () => {
  const tokens = [
    'sk-' + 'ant-' + 'x'.repeat(40),
    'sk-' + 'y'.repeat(30),
    'gh' + 'p_' + 'a'.repeat(30),
    'github' + '_pat_' + 'b'.repeat(30),
    'AK' + 'IA' + 'Z'.repeat(16),
    'xox' + 'b-' + '1234567890-abc',
    'ey' + 'Jhbgc.' + 'ey' + 'Jzdwi.' + 'sig_part',
  ];
  for (const token of tokens) {
    const result = redactText(`value ${token} end`);
    assert.equal(result.value, 'value <redacted> end');
    assert.equal(result.count, 1);
  }
});

test('rule 4: bearer token is redacted', () => {
  const result = redactText('Authorization: Bearer ' + 'q'.repeat(30));
  assert.equal(result.value, 'Authorization: Bearer <redacted>');
  assert.equal(result.count, 1);
});

test('rule 5: secret-named assignments keep name and separator', () => {
  const value = 'v'.repeat(12);
  assert.equal(redactText(`API_KEY=${value}`).value, 'API_KEY=<redacted>');
  assert.equal(redactText(`DB_PASSWORD: ${value}`).value, 'DB_PASSWORD: <redacted>');
  assert.equal(redactText(`{"AUTH_TOKEN": "${value}"}`).value, '{"AUTH_TOKEN": "<redacted>"}');
  assert.equal(redactText('API_KEY=abc').value, 'API_KEY=abc');
  assert.equal(redactText('NAME=' + value).value, 'NAME=' + value);
});

test('rule 6: emails become <email>', () => {
  const result = redactText('mail first.last+tag@mail.example.org now');
  assert.equal(result.value, 'mail <email> now');
  assert.equal(result.count, 1);
});

test('rule 7: IPv4 addresses become <ip>', () => {
  const result = redactText('host 192.168.10.25 and 10.0.0.1:8080');
  assert.equal(result.value, 'host <ip> and <ip>:8080');
  assert.equal(result.count, 2);
  assert.equal(redactText('version 2.1.308').value, 'version 2.1.308');
});

test('rule 8: extra patterns become <redacted>', () => {
  const result = redactText('project Falcon and falcon', { extraPatterns: [/Falcon/, /falcon/i] });
  assert.equal(result.value, 'project <redacted> and <redacted>');
  assert.equal(result.count, 2);
});

test('redactTimeline redacts every nested string and counts', () => {
  const timeline = {
    version: 1,
    meta: { cwd: '/Users/alice/app', durationMs: 5, isWorktree: false, title: null },
    events: [
      { type: 'tool_result', t: 0, turn: 1, lines: ['see /home/bob/log', 'ok'], totalLines: 2 },
      { type: 'text', t: 1, turn: 1, text: 'mail a@b.example' },
    ],
  };
  const result = redactTimeline(timeline);
  assert.equal(result.count, 3);
  assert.equal(result.value.meta.cwd, '~/app');
  assert.deepEqual(result.value.events[0].lines, ['see ~/log', 'ok']);
  assert.equal(result.value.events[1].text, 'mail <email>');
  assert.equal(result.value.meta.durationMs, 5);
  assert.equal(timeline.meta.cwd, '/Users/alice/app');
});
