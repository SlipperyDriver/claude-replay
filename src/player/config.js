const CONFIG_LENGTH = /^(auto|0|\d+(\.\d+)?(px|%|em|rem|vh|vw|vmin|vmax|ch|pt))$/;
const CONFIG_FONT = /^[^;{}<>\\]+$/;

const CONFIG_STRING_CHECKS = {
  width: (v) => CONFIG_LENGTH.test(v),
  height: (v) => CONFIG_LENGTH.test(v),
  fit: (v) => v === 'none' || v === 'width',
  theme: (v) => v === 'dark' || v === 'light',
  fontFamily: (v) => CONFIG_FONT.test(v),
};

const CONFIG_MS = [0, 600000];
const CONFIG_MULTIPLIER = [0.05, 20];

const CONFIG_RANGES = {
  columns: [40, 300, true],
  fontSize: [6, 48],
  scale: [0.25, 4],
  seed: [-2147483648, 2147483647, true],
  speed: [0.1, 20],
  gapMs: [0, 5000],
  typing: {
    cps: [1, 100000],
    jitter: [0, 0.9],
    punctuationPauseMs: CONFIG_MS,
    maxMs: CONFIG_MS,
    submitPauseMs: CONFIG_MS,
    multiplier: CONFIG_MULTIPLIER,
  },
  thinking: { scale: [0, 100], minMs: CONFIG_MS, maxMs: CONFIG_MS, multiplier: CONFIG_MULTIPLIER },
  tool: { scale: [0, 100], minMs: CONFIG_MS, maxMs: CONFIG_MS, multiplier: CONFIG_MULTIPLIER },
  output: { cps: [1, 100000], maxMs: CONFIG_MS, multiplier: CONFIG_MULTIPLIER },
  results: { lines: [0, 50, true] },
  status: { contextWindow: [1000, 1000000000, true], compactions: [0, 1000000, true] },
};

function configDeepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(configDeepFreeze);
    Object.freeze(value);
  }
  return value;
}

export const DEFAULT_CONFIG = configDeepFreeze({
  width: '100%',
  height: '600px',
  fit: 'none',
  columns: 100,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
  fontSize: 13,
  scale: 1,
  theme: 'dark',
  autoplay: true,
  loop: false,
  controls: true,
  seed: 1,
  speed: 1,
  turns: null,
  gapMs: 150,
  typing: { cps: 28, jitter: 0.35, punctuationPauseMs: 120, maxMs: 6000, submitPauseMs: 350, multiplier: 1 },
  thinking: { scale: 0.25, minMs: 800, maxMs: 4000, multiplier: 1 },
  tool: { scale: 0.25, minMs: 400, maxMs: 3000, multiplier: 1 },
  output: { cps: 600, maxMs: 2500, multiplier: 1 },
  results: { show: true, lines: 3 },
  header: { show: true, billing: null },
  status: { project: null, branch: null, model: null, effort: null, contextWindow: 1000000, compactions: 0 },
});

function configIsObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function configNumber(value, fallback, range) {
  const n =
    typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  const clamped = Math.min(range[1], Math.max(range[0], n));
  return range[2] ? Math.round(clamped) : clamped;
}

function configTurns(value) {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const pair = value.map((v) => configNumber(v, NaN, [1, Number.MAX_SAFE_INTEGER, true]));
  return Number.isFinite(pair[0]) && Number.isFinite(pair[1]) && pair[0] <= pair[1] ? pair : null;
}

function configField(key, fallback, value, range) {
  if (typeof fallback === 'number') return configNumber(value, fallback, range);
  if (typeof fallback === 'boolean') return typeof value === 'boolean' ? value : fallback;
  if (key === 'turns') return configTurns(value);
  if (fallback === null) return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
  const check = CONFIG_STRING_CHECKS[key];
  return typeof value === 'string' && check(value.trim()) ? value.trim() : fallback;
}

export function normalizeConfig(partial) {
  try {
    const input = configIsObject(partial) ? partial : {};
    const out = {};
    for (const key of Object.keys(DEFAULT_CONFIG)) {
      const fallback = DEFAULT_CONFIG[key];
      if (configIsObject(fallback)) {
        const given = configIsObject(input[key]) ? input[key] : {};
        const ranges = CONFIG_RANGES[key] || {};
        out[key] = {};
        for (const sub of Object.keys(fallback)) {
          out[key][sub] = configField(sub, fallback[sub], given[sub], ranges[sub]);
        }
      } else {
        out[key] = configField(key, fallback, input[key], CONFIG_RANGES[key]);
      }
    }
    return out;
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }
}
