import { normalizeConfig } from './config.js';

const SCHEDULE_TYPES = ['prompt', 'thinking', 'text', 'tool_use', 'tool_result'];
const SCHEDULE_PUNCTUATION = '.,;:?!';

export function validateTimeline(obj) {
  if (obj === null || typeof obj !== 'object') throw new Error('timeline: expected an object');
  if (obj.version !== 1) throw new Error(`version: expected 1, got ${JSON.stringify(obj.version)}`);
  if (!Array.isArray(obj.events)) throw new Error('events: expected an array');
  obj.events.forEach((event, i) => {
    if (event === null || typeof event !== 'object' || !SCHEDULE_TYPES.includes(event.type)) {
      const got = event === null || typeof event !== 'object' ? typeof event : JSON.stringify(event.type);
      throw new Error(`events[${i}].type: unknown type ${got}`);
    }
  });
  return obj;
}

function scheduleMulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function scheduleClamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function scheduleNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function scheduleTyping(text, typing, rng) {
  const base = 1000 / typing.cps;
  const delays = [];
  let sum = 0;
  for (let i = 0; i < text.length; i++) {
    let delay = base * (1 + typing.jitter * (2 * rng() - 1));
    if (SCHEDULE_PUNCTUATION.includes(text[i])) delay += typing.punctuationPauseMs;
    delays.push(delay);
    sum += delay;
  }
  const factor = (sum > typing.maxMs ? typing.maxMs / sum : 1) * typing.multiplier;
  const duration = Math.round(sum * factor);
  let acc = 0;
  const charTimes = delays.map((delay) => {
    acc += delay * factor;
    return Math.min(duration, Math.round(acc));
  });
  return { duration, charTimes };
}

export function buildSchedule(timeline, config) {
  const cfg = normalizeConfig(config);
  const events = timeline && Array.isArray(timeline.events) ? timeline.events : [];
  const rng = scheduleMulberry32(cfg.seed);
  const gap = Math.round(cfg.gapMs);
  const segments = [];
  let cursor = 0;
  let totalMs = 0;
  events.forEach((event, eventIndex) => {
    if (cfg.turns) {
      const turn = Number(event.turn);
      if (!(turn >= cfg.turns[0] && turn <= cfg.turns[1])) return;
    }
    if (event.type === 'tool_result' && !cfg.results.show) return;
    const place = (kind, duration, extra, pause) => {
      const segment = {
        kind,
        start: cursor,
        end: cursor + duration,
        eventIndex,
        turn: scheduleNumber(event.turn),
        sessionMs: scheduleNumber(event.t),
      };
      if (Number.isFinite(event.contextTokens)) segment.contextTokens = event.contextTokens;
      segments.push(Object.assign(segment, extra));
      totalMs = Math.max(totalMs, segment.end);
      cursor = segment.end + pause;
    };
    if (event.type === 'prompt') {
      const typed = scheduleTyping(String(event.text === undefined || event.text === null ? '' : event.text), cfg.typing, rng);
      place('type', typed.duration, { charTimes: typed.charTimes }, 0);
      place('submit', 0, {}, Math.round(cfg.typing.submitPauseMs));
    } else if (event.type === 'thinking') {
      const { scale, minMs, maxMs, multiplier } = cfg.thinking;
      const ms = scheduleClamp(scheduleNumber(event.durationMs) * scale, minMs, maxMs) * multiplier;
      place('think', Math.round(ms), {}, gap);
    } else if (event.type === 'text') {
      const { cps, maxMs, multiplier } = cfg.output;
      const length = String(event.text === undefined || event.text === null ? '' : event.text).length;
      place('stream', Math.round(Math.min((length / cps) * 1000, maxMs) * multiplier), {}, gap);
    } else if (event.type === 'tool_use') {
      const { scale, minMs, maxMs, multiplier } = cfg.tool;
      const ms = scheduleClamp(scheduleNumber(event.durationMs) * scale, minMs, maxMs) * multiplier;
      place('tool', Math.round(ms), {}, gap);
    } else {
      place('result', 0, {}, gap);
    }
  });
  return { totalMs, segments };
}
