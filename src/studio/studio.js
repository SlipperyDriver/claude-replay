import { parseTranscript } from '../cli/parse.js';
import { escapeHtml } from '../cli/bundle.js';
import { validateTimeline } from '../player/schedule.js';

const STUDIO_POSIX_USER = /"cwd":"(?:\/Users|\/home)\/([^\/"]+)/;
const STUDIO_WINDOWS_USER = /"cwd":"[A-Za-z]:\\\\Users\\\\([^\\"]+)/;
const STUDIO_MAX_FILE_NAME = 60;

function studioTurns(fields) {
  const from = String(fields.turnsFrom ?? '').trim();
  const to = String(fields.turnsTo ?? '').trim();
  if (from === '' && to === '') return undefined;
  if (/^\d+$/.test(from) && /^\d+$/.test(to) && Number(from) >= 1 && Number(from) <= Number(to)) {
    return [Number(from), Number(to)];
  }
  throw new Error(`bad turn range "${from}-${to}": expected 1 <= from <= to`);
}

function studioMaxResultLines(fields) {
  const value = String(fields.maxResultLines ?? '').trim();
  if (value === '') return undefined;
  if (/^\d+$/.test(value)) return Number(value);
  throw new Error(`bad max result lines "${value}": expected non-negative integer`);
}

function studioPatterns(fields) {
  return String(fields.redact ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => {
      try {
        return new RegExp(line, 'g');
      } catch {
        throw new Error(`bad redact pattern "${line}": invalid regex`);
      }
    });
}

function studioUsername(text) {
  const match = STUDIO_POSIX_USER.exec(text) ?? STUDIO_WINDOWS_USER.exec(text);
  return match ? match[1] : undefined;
}

function studioParseOptions(text, fields) {
  const options = {
    thinkingText: fields.thinkingText === true,
    extraPatterns: studioPatterns(fields),
  };
  const turns = studioTurns(fields);
  if (turns !== undefined) options.turns = turns;
  const maxResultLines = studioMaxResultLines(fields);
  if (maxResultLines !== undefined) options.maxResultLines = maxResultLines;
  const title = String(fields.title ?? '').trim();
  if (title !== '') options.title = title;
  const username = studioUsername(text);
  if (username !== undefined) options.username = username;
  return options;
}

export function readInputFile(file) {
  return file.text().then((text) => {
    const name = String(file.name);
    return { name, kind: /\.json$/i.test(name) ? 'timeline' : 'transcript', text };
  });
}

export function timelineFromInput(input, fields = {}) {
  if (input.kind === 'timeline') {
    let parsed;
    try {
      parsed = JSON.parse(input.text);
    } catch (error) {
      throw new Error(`${input.name} is not valid JSON: ${error.message}`);
    }
    return { timeline: validateTimeline(parsed), stats: null };
  }
  const { timeline, stats } = parseTranscript(input.text, studioParseOptions(input.text, fields));
  return { timeline, stats };
}

export function exportFileName(title) {
  const slug = String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, STUDIO_MAX_FILE_NAME)
    .replace(/-+$/, '');
  return slug === '' ? 'showcase' : slug;
}

export function embedSnippet(fileName, config, title) {
  const style = `width:${config.width};height:${config.height};border:0`;
  return `<iframe src="${escapeHtml(fileName)}" title="${escapeHtml(title)}" style="${escapeHtml(style)}" loading="lazy"></iframe>`;
}
