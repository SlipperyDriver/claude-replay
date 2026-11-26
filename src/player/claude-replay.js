import { normalizeConfig } from './config.js';
import { statusParts, headerLines, footerText, toolLabel, parseMarkdownLite } from './format.js';
import { validateTimeline, buildSchedule } from './schedule.js';
import { STYLES } from './styles.js';

const PLAYER_SPEEDS = ['0.5', '1', '1.5', '2', '4'];
const PLAYER_GLYPHS = ['·', '✢', '✳', '✶', '✻', '✽'];
const PLAYER_SVG_NS = 'http://www.w3.org/2000/svg';
const PLAYER_LOGO = [
  [2, 0, 8, 1],
  [2, 1, 8, 2],
  [0, 3, 12, 2],
  [2, 5, 8, 1],
  [2, 6, 1, 2],
  [4, 6, 1, 2],
  [7, 6, 1, 2],
  [9, 6, 1, 2],
];
const PLAYER_PAD = 16;

function playerEl(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function playerLogo() {
  const svg = document.createElementNS(PLAYER_SVG_NS, 'svg');
  svg.setAttribute('class', 'cr-logo');
  svg.setAttribute('viewBox', '0 0 12 8');
  svg.setAttribute('aria-hidden', 'true');
  for (const [x, y, w, h] of PLAYER_LOGO) {
    const rect = document.createElementNS(PLAYER_SVG_NS, 'rect');
    rect.setAttribute('x', x);
    rect.setAttribute('y', y);
    rect.setAttribute('width', w);
    rect.setAttribute('height', h);
    svg.appendChild(rect);
  }
  return svg;
}

function playerRule(labeled) {
  const node = playerEl('div', 'cr-rule');
  node.appendChild(playerEl('span', 'cr-rule-line'));
  const label = playerEl('span', 'cr-rule-label');
  if (labeled) {
    node.appendChild(label);
    node.appendChild(playerEl('span', 'cr-rule-tail'));
  }
  return { node, label };
}

function playerClock(ms) {
  const secs = Math.floor(Math.max(0, ms) / 1000);
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}

function playerMarkdown(container, text) {
  container.textContent = '';
  for (const block of parseMarkdownLite(text)) {
    if (block.kind === 'code') {
      container.appendChild(playerEl('pre', 'cr-code', block.text));
      continue;
    }
    const row = playerEl('div', `cr-${block.kind}`);
    if (block.kind === 'bullet') row.appendChild(playerEl('span', null, '• '));
    for (const span of block.spans) {
      const tag = span.kind === 'code' ? 'code' : span.kind === 'bold' ? 'strong' : 'span';
      row.appendChild(playerEl(tag, null, span.text));
    }
    container.appendChild(row);
  }
}

export class ClaudeReplay extends HTMLElement {
  static get observedAttributes() {
    return ['src', 'config'];
  }

  constructor() {
    super();
    this._raw = {};
    this._cfg = normalizeConfig({});
    this._timeline = null;
    this._provided = null;
    this._schedule = null;
    this._errors = new Map();
    this._state = 'loading';
    this._connected = false;
    this._started = false;
    this._time = 0;
    this._last = null;
    this._raf = 0;
    this._observer = null;
    this._loadToken = 0;
    this._tick = this._tick.bind(this);
    this._build();
    this._resetView();
    this._applyLayout();
    this._renderChrome();
  }

  attributeChangedCallback(name, oldValue, value) {
    if (name === 'config') {
      let parsed = {};
      try {
        parsed = value === null ? {} : JSON.parse(value);
      } catch {
        parsed = {};
      }
      this._setConfig(parsed);
    } else if (name === 'src' && this._started && value !== oldValue) {
      this._provided = null;
      this._load();
    }
  }

  connectedCallback() {
    this._connected = true;
    this._applyHost();
    this._applyFont();
    this.setAttribute('state', this._state);
    this._observer = new ResizeObserver(() => this._applyFont());
    this._observer.observe(this);
    if (this._state === 'playing' && !this._raf) {
      this._last = null;
      this._raf = requestAnimationFrame(this._tick);
    }
    if (!this._started) {
      this._started = true;
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => this._load(), { once: true });
      } else {
        this._load();
      }
    }
  }

  disconnectedCallback() {
    this._connected = false;
    cancelAnimationFrame(this._raf);
    this._raf = 0;
    if (this._observer) this._observer.disconnect();
    this._observer = null;
  }

  get timeline() {
    return this._timeline;
  }

  set timeline(value) {
    if (value === null || value === undefined) return;
    this._provided = value;
    this._loadToken++;
    if (!this._started) return;
    try {
      this._setTimeline(value);
    } catch (error) {
      this._fail(error);
    }
  }

  get config() {
    return normalizeConfig(this._raw);
  }

  set config(value) {
    this._setConfig(value);
  }

  get duration() {
    return this._schedule ? this._schedule.totalMs : 0;
  }

  get currentTime() {
    return this._time;
  }

  set currentTime(value) {
    this.seek(value);
  }

  play() {
    if (!this._schedule || this._state === 'playing') return;
    if (this._time >= this._schedule.totalMs) {
      this._time = 0;
      this._sync(0);
    }
    this._setState('playing');
    this._last = null;
    this._raf = requestAnimationFrame(this._tick);
  }

  pause() {
    if (this._state !== 'playing') return;
    cancelAnimationFrame(this._raf);
    this._raf = 0;
    this._setState('paused');
  }

  restart() {
    this.seek(0);
    if (this._state === 'playing') {
      if (!this._raf) {
        this._last = null;
        this._raf = requestAnimationFrame(this._tick);
      }
    } else {
      this.play();
    }
  }

  seek(ms) {
    if (!this._schedule) return;
    const total = this._schedule.totalMs;
    this._time = Math.min(total, Math.max(0, Number(ms) || 0));
    this._sync(this._time);
    if (this._state === 'ended' && this._time < total) this._setState('paused');
  }

  _build() {
    const shadow = this.attachShadow({ mode: 'open' });
    const root = playerEl('div', 'cr-root');
    const screen = playerEl('div', 'cr-screen');
    const probe = playerEl('span', 'cr-probe', '0'.repeat(20));
    const header = playerEl('div', 'cr-header');
    const history = playerEl('div', 'cr-history');
    const input = playerEl('div', 'cr-input');
    const top = playerRule(true);
    const bottom = playerRule(false);
    const inputRow = playerEl('div', 'cr-row cr-input-row');
    const typed = playerEl('span');
    const body = playerEl('div', 'cr-body');
    body.appendChild(typed);
    body.appendChild(playerEl('span', 'cr-cursor'));
    inputRow.appendChild(playerEl('span', 'cr-mark', '❯ '));
    inputRow.appendChild(body);
    input.appendChild(top.node);
    input.appendChild(inputRow);
    input.appendChild(bottom.node);
    const status = playerEl('div', 'cr-status');
    const footer = playerEl('div', 'cr-footer');
    [probe, header, history, input, status, footer].forEach((node) => screen.appendChild(node));

    const controls = playerEl('div', 'cr-controls');
    const play = playerEl('button', 'cr-btn', '▶');
    play.type = 'button';
    const restart = playerEl('button', 'cr-btn', '↺');
    restart.type = 'button';
    const scrub = playerEl('input', 'cr-scrub');
    scrub.type = 'range';
    scrub.min = '0';
    scrub.max = '0';
    scrub.step = '1';
    scrub.value = '0';
    const time = playerEl('span', 'cr-time', '0:00 / 0:00');
    const speed = playerEl('select', 'cr-speed');
    for (const value of PLAYER_SPEEDS) {
      const option = playerEl('option', null, `${value}x`);
      option.value = value;
      speed.appendChild(option);
    }
    [play, restart, scrub, time, speed].forEach((node) => controls.appendChild(node));

    root.appendChild(screen);
    root.appendChild(controls);
    shadow.appendChild(playerEl('style', null, STYLES));
    shadow.appendChild(root);

    play.addEventListener('click', () => (this._state === 'playing' ? this.pause() : this.play()));
    restart.addEventListener('click', () => this.restart());
    scrub.addEventListener('input', () => this.seek(Number(scrub.value)));
    speed.addEventListener('change', () => this._setConfig(Object.assign({}, this._raw, { speed: Number(speed.value) })));

    this._els = {
      screen,
      probe,
      header,
      history,
      input,
      label: top.label,
      typed,
      status,
      footer,
      controls,
      play,
      scrub,
      time,
      speed,
    };
  }

  _meta() {
    return (this._timeline && this._timeline.meta) || {};
  }

  _setConfig(raw) {
    const prev = this._cfg;
    this._raw = raw !== null && typeof raw === 'object' ? raw : {};
    this._cfg = normalizeConfig(this._raw);
    this._applyLayout();
    if (!this._schedule) {
      this._renderChrome();
      return;
    }
    if (JSON.stringify(Object.assign({}, prev, { speed: 0 })) !== JSON.stringify(Object.assign({}, this._cfg, { speed: 0 }))) {
      this._rebuild();
    }
  }

  _applyHost() {
    if (!this._connected) return;
    this.style.setProperty('--cr-width', this._cfg.width);
    this.style.setProperty('--cr-height', this._cfg.height);
    this.setAttribute('theme', this._cfg.theme);
  }

  _applyLayout() {
    const els = this._els;
    els.controls.hidden = !this._cfg.controls;
    els.screen.style.setProperty('--cr-font', this._cfg.fontFamily);
    this._applyFont();
    const value = String(this._cfg.speed);
    if (!Array.from(els.speed.options).some((option) => option.value === value)) {
      const option = playerEl('option', null, `${value}x`);
      option.value = value;
      els.speed.appendChild(option);
    }
    els.speed.value = value;
    this._applyHost();
  }

  _applyFont() {
    const cfg = this._cfg;
    let px = cfg.fontSize * cfg.scale;
    if (cfg.fit === 'width' && this._connected) {
      const ratio = this._els.probe.getBoundingClientRect().width / 2000;
      const room = this.clientWidth - PLAYER_PAD;
      if (ratio > 0 && room > 0) px = room / (cfg.columns * ratio);
    }
    this._els.screen.style.setProperty('--cr-font-size', `${Math.max(1, px)}px`);
  }

  _renderChrome() {
    const meta = this._meta();
    const { header, label, input, footer } = this._els;
    header.textContent = '';
    header.hidden = !this._cfg.header.show;
    if (this._cfg.header.show) {
      const [first, second, third] = headerLines(meta, this._cfg);
      const info = playerEl('div');
      const title = playerEl('div');
      const name = 'Claude Code';
      if (first.startsWith(name)) {
        title.appendChild(playerEl('strong', null, name));
        title.appendChild(playerEl('span', 'cr-dim', first.slice(name.length)));
      } else {
        title.textContent = first;
      }
      info.appendChild(title);
      info.appendChild(playerEl('div', 'cr-dim', second));
      info.appendChild(playerEl('div', 'cr-dim', third));
      header.appendChild(playerLogo());
      header.appendChild(info);
    }
    label.textContent = meta.agent || '';
    input.classList.toggle('cr-unlabeled', !meta.agent);
    footer.textContent = '';
    const text = footerText(meta.permissionMode);
    const cut = text.indexOf(' (');
    const main = cut < 0 ? text : text.slice(0, cut);
    footer.appendChild(playerEl('span', text.startsWith('?') ? 'cr-dim' : 'cr-accent', main));
    if (cut >= 0) footer.appendChild(playerEl('span', 'cr-dim', text.slice(cut)));
    this._renderStatus();
  }

  _renderStatus() {
    const p = statusParts(this._meta(), this._cfg, this._live);
    const node = this._els.status;
    node.textContent = '';
    const add = (className, text) => node.appendChild(playerEl('span', className, text));
    if (p.project) add('cr-blue', `${p.project} `);
    add('cr-magenta', `(${p.branch})`);
    add('cr-dim', ' | ');
    add('cr-cyan', p.model);
    if (p.effort) {
      add('cr-dim', ' · ');
      add('cr-cyan-bright', p.effort);
    }
    add('cr-dim', ' | ');
    add(`cr-${p.tier}`, `${p.bar} ${p.pct}%`);
    add('cr-dim', ` of ${p.size}`);
    add('cr-dim', ' | ⏱ ');
    add(null, p.duration);
    add('cr-dim', ' | ⟳ ');
    add(null, String(p.compactions));
  }

  _resetView() {
    this._els.history.textContent = '';
    this._els.typed.textContent = '';
    this._next = 0;
    this._open = null;
    this._at = 0;
    this._tools = new Map();
    this._live = { contextTokens: 0, sessionMs: 0 };
    this._statusDirty = false;
    this._scrollDirty = false;
    this._renderStatus();
  }

  _row(className, mark, text) {
    const row = playerEl('div', `cr-row ${className}`);
    const markNode = playerEl('span', 'cr-mark', mark);
    const body = playerEl('div', 'cr-body', text);
    row.appendChild(markNode);
    row.appendChild(body);
    this._els.history.appendChild(row);
    this._scrollDirty = true;
    return { row, mark: markNode, body };
  }

  _setState(state) {
    if (this._state === state) return;
    this._state = state;
    if (this._connected) this.setAttribute('state', state);
    this._syncControls();
    this.dispatchEvent(new CustomEvent('statechange', { detail: { state } }));
  }

  _syncControls() {
    const els = this._els;
    const total = this.duration;
    els.scrub.max = String(total);
    els.scrub.value = String(Math.round(this._time));
    els.time.textContent = `${playerClock(this._time)} / ${playerClock(total)}`;
    els.play.textContent = this._state === 'playing' ? '❚❚' : '▶';
  }

  async _load() {
    const token = ++this._loadToken;
    try {
      let data = this._provided;
      if (!data) {
        const script = this.querySelector('script[data-timeline]');
        const src = this.getAttribute('src');
        if (script) {
          data = JSON.parse(script.textContent);
        } else if (src) {
          this._setState('loading');
          const response = await fetch(src);
          if (!response.ok) throw new Error(`HTTP ${response.status} ${src}`);
          data = await response.json();
        } else {
          return;
        }
      }
      if (token !== this._loadToken) return;
      this._setTimeline(data);
    } catch (error) {
      if (token === this._loadToken) this._fail(error);
    }
  }

  _setTimeline(data) {
    validateTimeline(data);
    cancelAnimationFrame(this._raf);
    this._raf = 0;
    this._timeline = data;
    this._errors = new Map(
      data.events.filter((event) => event.type === 'tool_result').map((event) => [event.toolUseId, event.isError === true]),
    );
    this._schedule = null;
    this._time = 0;
    this._last = null;
    this._rebuild();
    this._setState('ready');
    if (this._cfg.autoplay) this.play();
  }

  _fail(error) {
    cancelAnimationFrame(this._raf);
    this._raf = 0;
    this._timeline = null;
    this._schedule = null;
    this._time = 0;
    this._setState('error');
    this._resetView();
    this._renderChrome();
    this._row('cr-error', '', `Failed to load timeline: ${error && error.message ? error.message : String(error)}`);
    this._syncControls();
  }

  _rebuild() {
    const oldTotal = this._schedule ? this._schedule.totalMs : 0;
    const ratio = oldTotal > 0 ? this._time / oldTotal : 0;
    this._schedule = buildSchedule(this._timeline, this._cfg);
    this._time = ratio * this._schedule.totalMs;
    this._resetView();
    this._renderChrome();
    this._sync(this._time);
  }

  _tick(now) {
    this._raf = 0;
    if (this._state !== 'playing' || !this._schedule) return;
    const total = this._schedule.totalMs;
    if (this._last !== null) this._time += (now - this._last) * this._cfg.speed;
    this._last = now;
    if (this._time >= total) {
      this._time = total;
      this._sync(total);
      if (this._cfg.loop && total > 0) this.restart();
      else this._setState('ended');
      return;
    }
    this._sync(this._time);
    this._raf = requestAnimationFrame(this._tick);
  }

  _sync(t) {
    if (!this._schedule) return;
    if (t < this._at) this._resetView();
    this._at = t;
    const segments = this._schedule.segments;
    if (this._open && t >= this._open.seg.end) {
      this._finish(this._open);
      this._open = null;
    }
    while (!this._open && this._next < segments.length && segments[this._next].start <= t) {
      const open = this._begin(segments[this._next++]);
      if (t >= open.seg.end) this._finish(open);
      else this._open = open;
    }
    if (this._open) this._progress(this._open, t);
    if (this._statusDirty) {
      this._renderStatus();
      this._statusDirty = false;
    }
    if (this._scrollDirty) {
      this._els.history.scrollTop = this._els.history.scrollHeight;
      this._scrollDirty = false;
    }
    this._syncControls();
  }

  _settle(tool, isError) {
    tool.mark.className = `cr-mark ${isError ? 'cr-red' : 'cr-green'}`;
  }

  _begin(seg) {
    const ev = this._timeline.events[seg.eventIndex];
    const open = { seg, ev, row: null, shown: -1 };
    if (Number.isFinite(seg.contextTokens)) this._live.contextTokens = seg.contextTokens;
    this._live.sessionMs = seg.sessionMs;
    this._statusDirty = true;
    if (seg.kind === 'type') {
      this._els.typed.textContent = '';
    } else if (seg.kind === 'submit') {
      this._els.typed.textContent = '';
      this._row('cr-prompt', '❯ ', String(ev.text ?? ''));
    } else if (seg.kind === 'think') {
      open.row = this._row('cr-think', '✻ ', 'Thinking…');
    } else if (seg.kind === 'stream') {
      open.row = this._row('cr-text', '⏺ ', '');
      open.row.body.classList.add('cr-block');
    } else if (seg.kind === 'tool') {
      open.row = this._row('cr-tool', '⏺ ', toolLabel(ev));
      open.row.mark.classList.add('cr-wait');
      this._tools.set(ev.id, open.row);
    } else if (seg.kind === 'result') {
      const tool = this._tools.get(ev.toolUseId);
      if (tool) this._settle(tool, ev.isError === true);
      const lines = (ev.lines || []).slice(0, this._cfg.results.lines).map((text) => ({ text, dim: false }));
      const hidden = Math.max(0, (Number(ev.totalLines) || 0) - lines.length);
      if (hidden > 0) lines.push({ text: `… +${hidden} line${hidden === 1 ? '' : 's'} (ctrl+o to expand)`, dim: true });
      if (lines.length === 0) lines.push({ text: '(No content)', dim: true });
      lines.forEach((line, i) => {
        const tone = ev.isError === true && !line.dim ? ' cr-red' : line.dim ? ' cr-dim' : '';
        this._row(`cr-result${tone}`, i === 0 ? '  ⎿  ' : '     ', line.text);
      });
    }
    return open;
  }

  _progress(open, t) {
    const { seg, ev } = open;
    const elapsed = t - seg.start;
    if (seg.kind === 'type') {
      const times = seg.charTimes;
      let count = 0;
      while (count < times.length && times[count] <= elapsed) count++;
      if (count !== open.shown) {
        open.shown = count;
        this._els.typed.textContent = String(ev.text ?? '').slice(0, count);
      }
    } else if (seg.kind === 'think') {
      const index = Math.floor(elapsed / 120) % PLAYER_GLYPHS.length;
      if (index !== open.shown) {
        open.shown = index;
        open.row.mark.textContent = `${PLAYER_GLYPHS[index]} `;
      }
    } else if (seg.kind === 'stream') {
      const text = String(ev.text ?? '');
      const count = Math.floor(text.length * Math.min(1, elapsed / (seg.end - seg.start)));
      if (count !== open.shown) {
        open.shown = count;
        playerMarkdown(open.row.body, text.slice(0, count));
        this._scrollDirty = true;
      }
    }
  }

  _finish(open) {
    const { seg, ev } = open;
    if (seg.kind === 'type') {
      this._els.typed.textContent = String(ev.text ?? '');
    } else if (seg.kind === 'think') {
      const secs = Math.max(0, Math.round((Number(ev.durationMs) || 0) / 1000));
      open.row.mark.textContent = '∴ ';
      open.row.body.textContent = `Thought for ${secs}s`;
      open.row.row.classList.add('cr-dim');
    } else if (seg.kind === 'stream') {
      playerMarkdown(open.row.body, String(ev.text ?? ''));
      this._scrollDirty = true;
    } else if (seg.kind === 'tool' && !this._cfg.results.show) {
      this._settle(open.row, this._errors.get(ev.id) === true);
    }
  }
}

if (!customElements.get('claude-replay')) customElements.define('claude-replay', ClaudeReplay);
