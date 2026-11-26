const HOME_PATTERNS = [
  /(?:\/Users|\/home)\/[^\/\s"'`]+/g,
  /[A-Za-z]:\\Users\\[^\\\s"'`]+/g,
];

const SECRET_PATTERNS = [
  /sk-ant-[A-Za-z0-9_-]{10,}/g,
  /sk-[A-Za-z0-9]{20,}/g,
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /xox[abprs]-[A-Za-z0-9-]{10,}/g,
  /eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/g,
];

const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+\/=-]{16,}/g;

const NAMED_SECRET_PATTERN =
  /\b([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL)[A-Z0-9_]*"?[ \t]*[=:][ \t]*"?)(?!<redacted>)[^\s"',]{4,}/g;

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

const IPV4_PATTERN = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceCounted(state, pattern, replacer) {
  state.text = state.text.replace(pattern, (...args) => {
    state.count += 1;
    return replacer(...args);
  });
}

export function redactText(text, options = {}) {
  const state = { text, count: 0 };

  for (const pattern of HOME_PATTERNS) {
    replaceCounted(state, pattern, () => '~');
  }

  if (typeof options.username === 'string' && options.username.length >= 3) {
    const usernamePattern = new RegExp(`(?<!\\w)${escapeRegExp(options.username)}(?!\\w)`, 'g');
    replaceCounted(state, usernamePattern, () => '<user>');
  }

  for (const pattern of SECRET_PATTERNS) {
    replaceCounted(state, pattern, () => '<redacted>');
  }

  replaceCounted(state, BEARER_PATTERN, () => 'Bearer <redacted>');
  replaceCounted(state, NAMED_SECRET_PATTERN, (match, prefix) => `${prefix}<redacted>`);
  replaceCounted(state, EMAIL_PATTERN, () => '<email>');
  replaceCounted(state, IPV4_PATTERN, () => '<ip>');

  for (const extra of options.extraPatterns ?? []) {
    const flags = extra.flags.includes('g') ? extra.flags : `${extra.flags}g`;
    replaceCounted(state, new RegExp(extra.source, flags), () => '<redacted>');
  }

  return { value: state.text, count: state.count };
}

function redactNode(node, options, state) {
  if (typeof node === 'string') {
    const result = redactText(node, options);
    state.count += result.count;
    return result.value;
  }
  if (Array.isArray(node)) {
    return node.map((item) => redactNode(item, options, state));
  }
  if (node !== null && typeof node === 'object') {
    return Object.fromEntries(
      Object.entries(node).map(([key, value]) => [key, redactNode(value, options, state)]),
    );
  }
  return node;
}

export function redactTimeline(timeline, options = {}) {
  const state = { count: 0 };
  const value = {
    ...timeline,
    meta: redactNode(timeline.meta, options, state),
    events: redactNode(timeline.events, options, state),
  };
  return { value, count: state.count };
}
