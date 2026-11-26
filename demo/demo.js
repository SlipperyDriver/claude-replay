import '../src/player/claude-replay.js';
import { DEFAULT_CONFIG } from '../src/player/config.js';
import { buildShowcaseHtml } from '../src/cli/bundle.js';
import { readInputFile, timelineFromInput, exportFileName, embedSnippet } from '../src/studio/studio.js';

const FIELDS = [
  ['speed', ['speed'], 'number'],
  ['gap-ms', ['gapMs'], 'number'],
  ['loop', ['loop'], 'boolean'],
  ['controls', ['controls'], 'boolean'],
  ['typing-cps', ['typing', 'cps'], 'number'],
  ['typing-jitter', ['typing', 'jitter'], 'number'],
  ['typing-max-ms', ['typing', 'maxMs'], 'number'],
  ['typing-multiplier', ['typing', 'multiplier'], 'number'],
  ['thinking-scale', ['thinking', 'scale'], 'number'],
  ['thinking-min-ms', ['thinking', 'minMs'], 'number'],
  ['thinking-max-ms', ['thinking', 'maxMs'], 'number'],
  ['thinking-multiplier', ['thinking', 'multiplier'], 'number'],
  ['tool-scale', ['tool', 'scale'], 'number'],
  ['tool-min-ms', ['tool', 'minMs'], 'number'],
  ['tool-max-ms', ['tool', 'maxMs'], 'number'],
  ['tool-multiplier', ['tool', 'multiplier'], 'number'],
  ['output-cps', ['output', 'cps'], 'number'],
  ['output-max-ms', ['output', 'maxMs'], 'number'],
  ['output-multiplier', ['output', 'multiplier'], 'number'],
  ['results-show', ['results', 'show'], 'boolean'],
  ['results-lines', ['results', 'lines'], 'number'],
  ['header-show', ['header', 'show'], 'boolean'],
  ['billing', ['header', 'billing'], 'text'],
  ['width', ['width'], 'text'],
  ['height', ['height'], 'text'],
  ['fit', ['fit'], 'text'],
  ['columns', ['columns'], 'number'],
  ['font-size', ['fontSize'], 'number'],
  ['scale', ['scale'], 'number'],
  ['font-family', ['fontFamily'], 'text'],
  ['theme', ['theme'], 'text'],
];

const TURN_IDS = ['turns-from', 'turns-to'];

const player = document.getElementById('player');
const form = document.getElementById('settings');
const output = document.getElementById('config-json');
const copyButton = document.getElementById('copy-config');
const fileInput = document.getElementById('timeline-file');
const status = document.getElementById('status');
const studioForm = document.getElementById('studio');
const inputStatus = document.getElementById('input-status');
const redactionCount = document.getElementById('redaction-count');
const snippetOutput = document.getElementById('embed-snippet');
const snippetButton = document.getElementById('copy-snippet');
const downloadTimelineButton = document.getElementById('download-timeline');
const exportShowcaseButton = document.getElementById('export-showcase');
const sourcesNode = document.getElementById('player-sources');
const exportSources = sourcesNode ? JSON.parse(sourcesNode.textContent) : null;

let input = null;
let inputToken = 0;

if (!exportSources) {
  exportShowcaseButton.disabled = true;
  exportShowcaseButton.title = 'Export needs index.html (npm run build)';
}

function pathGet(object, path) {
  return path.reduce((node, key) => node[key], object);
}

function pathSet(object, path, value) {
  const parent = path.slice(0, -1).reduce((node, key) => node[key], object);
  parent[path[path.length - 1]] = value;
}

function setStatus(text) {
  status.textContent = text;
}

function initForm() {
  for (const [id, path, kind] of FIELDS) {
    const input = document.getElementById(id);
    const value = pathGet(DEFAULT_CONFIG, path);
    if (kind === 'boolean') input.checked = value === true;
    else input.value = value === null ? '' : String(value);
  }
  for (const id of TURN_IDS) document.getElementById(id).value = '';
}

function readTurns() {
  const [from, to] = TURN_IDS.map((id) => Number(document.getElementById(id).value));
  const valid = (n) => Number.isInteger(n) && n >= 1;
  return valid(from) && valid(to) && from <= to ? [from, to] : null;
}

function buildConfig() {
  const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  for (const [id, path, kind] of FIELDS) {
    const input = document.getElementById(id);
    if (kind === 'boolean') {
      pathSet(config, path, input.checked);
    } else if (kind === 'number') {
      const raw = input.value.trim();
      const n = Number(raw);
      if (raw !== '' && Number.isFinite(n)) pathSet(config, path, n);
    } else {
      const raw = input.value.trim();
      if (raw !== '') pathSet(config, path, raw);
      else if (pathGet(DEFAULT_CONFIG, path) === null) pathSet(config, path, null);
    }
  }
  config.turns = readTurns();
  return config;
}

function currentTitle() {
  const typed = document.getElementById('parse-title').value.trim();
  return typed || (player.timeline && player.timeline.meta && player.timeline.meta.title) || 'claude-replay';
}

function updateSnippet() {
  snippetOutput.value = embedSnippet(`${exportFileName(currentTitle())}.html`, player.config, currentTitle());
}

function apply() {
  const config = buildConfig();
  output.value = JSON.stringify(config, null, 2);
  player.config = config;
  updateSnippet();
}

function messageOf(error) {
  return error && error.message ? error.message : String(error);
}

async function copyFrom(textarea, label) {
  try {
    await navigator.clipboard.writeText(textarea.value);
    setStatus(`${label} copied`);
  } catch (error) {
    textarea.select();
    setStatus(`Copy failed: ${messageOf(error)}`);
  }
}

function readParserFields() {
  return {
    turnsFrom: document.getElementById('parse-turns-from').value,
    turnsTo: document.getElementById('parse-turns-to').value,
    thinkingText: document.getElementById('parse-thinking-text').checked,
    maxResultLines: document.getElementById('parse-max-result-lines').value,
    redact: document.getElementById('parse-redact').value,
    title: document.getElementById('parse-title').value,
  };
}

function showInput() {
  if (!input) return;
  try {
    const { timeline, stats } = timelineFromInput(input, readParserFields());
    player.timeline = timeline;
    const events = stats ? stats.events : timeline.events.length;
    const turns = stats ? stats.turns : new Set(timeline.events.map((event) => event.turn)).size;
    const skipped = stats && stats.skippedLines > 0 ? `, ${stats.skippedLines} malformed lines skipped` : '';
    inputStatus.textContent = `Loaded ${input.name}: ${events} events, ${turns} turns${skipped}`;
    redactionCount.textContent = stats ? `${stats.redactions} redactions applied` : 'Timeline loaded as-is: no redaction applied';
    updateSnippet();
  } catch (error) {
    inputStatus.textContent = `Failed to load ${input.name}: ${messageOf(error)}`;
  }
}

async function handleFile(file) {
  if (!file) return;
  const token = ++inputToken;
  try {
    const next = await readInputFile(file);
    if (token !== inputToken) return;
    input = next;
    showInput();
  } catch (error) {
    if (token === inputToken) inputStatus.textContent = `Failed to read ${file.name}: ${messageOf(error)}`;
  }
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadTimeline() {
  if (!player.timeline) {
    inputStatus.textContent = 'No timeline loaded';
    return;
  }
  download('timeline.json', `${JSON.stringify(player.timeline, null, 2)}\n`, 'application/json');
}

function exportShowcase() {
  if (!player.timeline) {
    inputStatus.textContent = 'No timeline loaded';
    return;
  }
  const html = buildShowcaseHtml({
    timeline: player.timeline,
    config: player.config,
    title: currentTitle(),
    playerSources: exportSources,
  });
  download(`${exportFileName(currentTitle())}.html`, html, 'text/html');
}

form.addEventListener('submit', (event) => event.preventDefault());
form.addEventListener('input', apply);
form.addEventListener('change', apply);
studioForm.addEventListener('submit', (event) => event.preventDefault());
for (const type of ['input', 'change']) {
  studioForm.addEventListener(type, (event) => {
    if (!event.target.id || !event.target.id.startsWith('parse-')) return;
    showInput();
    updateSnippet();
  });
}
copyButton.addEventListener('click', () => copyFrom(output, 'Config'));
snippetButton.addEventListener('click', () => copyFrom(snippetOutput, 'Snippet'));
fileInput.addEventListener('change', () => handleFile(fileInput.files && fileInput.files[0]));
downloadTimelineButton.addEventListener('click', downloadTimeline);
exportShowcaseButton.addEventListener('click', exportShowcase);
document.addEventListener('dragover', (event) => {
  event.preventDefault();
  document.body.classList.add('dragging');
});
document.addEventListener('dragleave', () => document.body.classList.remove('dragging'));
document.addEventListener('drop', (event) => {
  event.preventDefault();
  document.body.classList.remove('dragging');
  handleFile(event.dataTransfer && event.dataTransfer.files[0]);
});
player.addEventListener('statechange', (event) => {
  setStatus(`State: ${event.detail.state}`);
  if (event.detail.state === 'ready') updateSnippet();
});
if (player.hasAttribute('state')) setStatus(`State: ${player.getAttribute('state')}`);

initForm();
apply();
inputStatus.textContent = 'No file loaded. Showing the built-in sample.';
