#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { userInfo } from 'node:os';
import { parseTranscript } from '../src/cli/parse.js';
import { buildShowcaseHtml } from '../src/cli/bundle.js';
import { buildStudioHtml } from '../src/cli/build-studio.js';

const USAGE = `Usage:
  claude-replay parse <transcript.jsonl> -o <timeline.json> [options]
  claude-replay bundle <timeline.json> -o <out.html> [options]
  claude-replay studio -o <out.html>

parse options:
  -o, --out <file>           output timeline JSON (required)
      --turns <A-B>          keep turns A through B (1-based, inclusive)
      --thinking-text        keep thinking text in the timeline
      --max-result-lines <N> max lines kept per tool result (default 20)
      --redact <regex>       extra redaction pattern (repeatable)
      --title <text>         timeline title
  -h, --help                 show this help

bundle options:
  -o, --out <file>           output self-contained HTML (required)
      --config <file>        partial player config JSON to embed
      --title <text>         page title
  -h, --help                 show this help

studio options:
  -o, --out <file>           output studio HTML (required)
  -h, --help                 show this help

Exit codes: 0 ok, 1 runtime error, 2 usage error
`;

class UsageError extends Error {}

const PARSE_OPTIONS = {
  out: { type: 'string', short: 'o' },
  turns: { type: 'string' },
  'thinking-text': { type: 'boolean' },
  'max-result-lines': { type: 'string' },
  redact: { type: 'string', multiple: true },
  title: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
};

function readArgs(argv, options) {
  try {
    return parseArgs({ args: argv, options, allowPositionals: true });
  } catch (error) {
    throw new UsageError(error.message);
  }
}

function parseTurns(value) {
  const match = /^(\d+)-(\d+)$/.exec(value);
  if (!match) throw new UsageError(`bad --turns "${value}": expected A-B`);
  const from = Number(match[1]);
  const to = Number(match[2]);
  if (from < 1 || to < from) throw new UsageError(`bad --turns "${value}": expected 1 <= A <= B`);
  return [from, to];
}

function parseCount(value, name) {
  if (!/^\d+$/.test(value)) throw new UsageError(`bad ${name} "${value}": expected non-negative integer`);
  return Number(value);
}

function parsePattern(value) {
  try {
    return new RegExp(value, 'g');
  } catch {
    throw new UsageError(`bad --redact "${value}": invalid regex`);
  }
}

function runParse(argv) {
  const { values, positionals } = readArgs(argv, PARSE_OPTIONS);
  if (values.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (positionals.length !== 1) throw new UsageError('parse: expected exactly one input transcript');
  if (!values.out) throw new UsageError('parse: missing -o/--out');

  const options = {
    thinkingText: values['thinking-text'] === true,
    username: userInfo().username,
    extraPatterns: (values.redact ?? []).map(parsePattern),
  };
  if (values.turns !== undefined) options.turns = parseTurns(values.turns);
  if (values['max-result-lines'] !== undefined) {
    options.maxResultLines = parseCount(values['max-result-lines'], '--max-result-lines');
  }
  if (values.title !== undefined) options.title = values.title;

  const input = positionals[0];
  let text;
  try {
    text = readFileSync(input, 'utf8');
  } catch (error) {
    throw new Error(`cannot read ${input}: ${error.message}`);
  }
  const { timeline, stats } = parseTranscript(text, options);
  try {
    mkdirSync(dirname(values.out), { recursive: true });
    writeFileSync(values.out, `${JSON.stringify(timeline, null, 2)}\n`);
  } catch (error) {
    throw new Error(`cannot write ${values.out}: ${error.message}`);
  }

  process.stdout.write(`wrote ${values.out}: ${stats.events} events, ${stats.turns} turns, ${stats.redactions} redactions\n`);
  if (stats.skippedLines > 0) process.stderr.write(`warning: skipped ${stats.skippedLines} malformed lines\n`);
  process.stderr.write('review output before publishing: redaction is pattern-based\n');
  return 0;
}

const BUNDLE_OPTIONS = {
  out: { type: 'string', short: 'o' },
  config: { type: 'string' },
  title: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
};

const PLAYER_FILES = ['config.js', 'format.js', 'schedule.js', 'styles.js', 'claude-replay.js'];

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`cannot read ${path}: ${error.message}`);
  }
}

function readSource(relative) {
  const path = new URL(`../${relative}`, import.meta.url);
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    throw new Error(`cannot read ${path.pathname}: ${error.message}`);
  }
}

function runBundle(argv) {
  const { values, positionals } = readArgs(argv, BUNDLE_OPTIONS);
  if (values.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (positionals.length !== 1) throw new UsageError('bundle: expected exactly one input timeline');
  if (!values.out) throw new UsageError('bundle: missing -o/--out');

  const timeline = readJson(positionals[0]);
  const config = values.config === undefined ? {} : readJson(values.config);
  const playerSources = PLAYER_FILES.map((name) => readSource(`src/player/${name}`));
  const html = buildShowcaseHtml({ timeline, config, title: values.title, playerSources });
  try {
    mkdirSync(dirname(values.out), { recursive: true });
    writeFileSync(values.out, html);
  } catch (error) {
    throw new Error(`cannot write ${values.out}: ${error.message}`);
  }

  process.stdout.write(`wrote ${values.out}: ${html.length} bytes\n`);
  return 0;
}

const STUDIO_OPTIONS = {
  out: { type: 'string', short: 'o' },
  help: { type: 'boolean', short: 'h' },
};

const APP_FILES = ['src/cli/redact.js', 'src/cli/parse.js', 'src/cli/bundle.js', 'src/studio/studio.js', 'demo/demo.js'];

function runStudio(argv) {
  const { values, positionals } = readArgs(argv, STUDIO_OPTIONS);
  if (values.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (positionals.length > 0) throw new UsageError('studio: takes no input files');
  if (!values.out) throw new UsageError('studio: missing -o/--out');

  const html = buildStudioHtml({
    shellHtml: readSource('demo/index.html'),
    sampleTimeline: JSON.parse(readSource('showcases/sample/timeline.json')),
    playerSources: PLAYER_FILES.map((name) => readSource(`src/player/${name}`)),
    appSources: APP_FILES.map(readSource),
  });
  try {
    mkdirSync(dirname(values.out), { recursive: true });
    writeFileSync(values.out, html);
  } catch (error) {
    throw new Error(`cannot write ${values.out}: ${error.message}`);
  }

  process.stdout.write(`wrote ${values.out}: ${html.length} bytes\n`);
  return 0;
}

const COMMANDS = {
  parse: runParse,
  bundle: runBundle,
  studio: runStudio,
};

function main(argv) {
  const [command, ...rest] = argv;
  if (command === '--help' || command === '-h') {
    process.stdout.write(USAGE);
    return 0;
  }
  if (!command) throw new UsageError('missing command');
  const run = COMMANDS[command];
  if (!run) throw new UsageError(`unknown command "${command}"`);
  return run(rest);
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  if (error instanceof UsageError) {
    process.stderr.write(`error: ${error.message}\n\n${USAGE}`);
    process.exitCode = 2;
  } else {
    process.stderr.write(`error: ${error.message}\n`);
    process.exitCode = 1;
  }
}
