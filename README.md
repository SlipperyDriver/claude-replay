# claude-replay

Replays a Claude Code session transcript (`.jsonl`) as a terminal-style animation. Four parts:

- `<claude-replay>` web component: `src/player/`
- Settings demo page: `demo/`
- Node CLI: `bin/claude-replay.js`. Converts a transcript to `timeline.json` and bundles a timeline into one self-contained HTML file.
- Studio: `index.html`, one committed file built from `demo/`. Opens a transcript or `timeline.json` in the browser and exports a showcase HTML or `timeline.json`.

No npm dependencies.

## Table of Contents

1. [Quick start](#quick-start)
2. [Studio](#studio)
3. [Embed](#embed)
4. [Configuration](#configuration)
5. [CLI](#cli)
6. [Privacy and redaction](#privacy-and-redaction)
7. [Timeline format](#timeline-format)
8. [Deploy to GitHub Pages](#deploy-to-github-pages)
9. [New showcase](#new-showcase)
10. [Development](#development)
11. [Limitations](#limitations)

## Quick start

Double-click `index.html` in the repo root. No install, npm or server is needed. The file loads from `file://` and makes no network requests (see [Studio](#studio)).

- Maintainers: ES modules do not load over `file://`, so the dev page at `demo/` and any page that imports `src/player/` need an HTTP server. From the repo root, run `npm run serve` (or `python3 -m http.server 8730`), then open `http://localhost:8730/demo/`. Export is disabled on the dev page because it has no player sources block.
- A bundled showcase, for example `showcases/sample/index.html`, has no external references and opens directly from `file://`.

## Studio

`index.html` is one file with the player, parser, redaction and export code inline. It reads files with the browser File API and never uploads them. Its Content-Security-Policy meta tag sets `default-src 'none'`, so the page cannot make network requests (`src/cli/build-studio.js:6`).

The right-hand column, top to bottom:

1. Input. Open a `.jsonl` transcript or a `timeline.json`, or drop a file anywhere on the page. A file name ending in `.json` loads as a timeline. Any other name is parsed as a transcript (`src/studio/studio.js:61-66`). A `timeline.json` loads as-is and is not redacted again. Claude Code transcripts are in `~/.claude/projects/`.
2. Parser. Applies to `.jsonl` input only. Each field maps to a `parse` flag:

   | Studio field | CLI flag | Studio default |
   |--------------|----------|----------------|
   | Title | `--title <text>` | empty: `meta.title` is `null` |
   | Keep turns from / to | `--turns <A-B>` | empty: all turns. Set both or neither. |
   | Include thinking text | `--thinking-text` | off |
   | Max result lines | `--max-result-lines <N>` | empty: `20` |
   | Extra redact patterns (one per line) | `--redact <regex>` | none |

   Fields re-parse on every change. An invalid value shows an error in the input status, and the player keeps the previous timeline (`demo/demo.js:156-170`).
3. Redaction. Shows `<R> redactions applied` for a transcript, or `Timeline loaded as-is: no redaction applied` for a `timeline.json` (`demo/demo.js:165`).
4. Review warning. Lists what pattern-based redaction does not catch. See [Privacy and redaction](#privacy-and-redaction).
5. Export:
   - Download timeline.json writes the same format as `parse` (`bin/claude-replay.js:109`).
   - Export showcase HTML writes one self-contained HTML file from `buildShowcaseHtml` (`src/cli/bundle.js:13-35`). The file name is the title in lowercase with `-` separators, for example `my-demo.html` (`src/studio/studio.js:82-90`). The Title field, or the timeline title, sets it.
   - Copy snippet copies an `<iframe>` for the exported file. Host the exported file next to your page and keep its name in `src`. Example for the title `My Demo` with default width and height:

     ```html
     <iframe src="my-demo.html" title="My Demo" style="width:100%;height:600px;border:0" loading="lazy"></iframe>
     ```

     The snippet uses `width` and `height` from the current config (`src/studio/studio.js:92-95`).
6. Player settings, below Export. Changes apply to the player at once. The Config JSON box shows the full config (`demo/demo.js:95-129`).

Config and turns:

- Config is frozen at export. The export writes the full current config into the `config` attribute of `<claude-replay>` (`src/cli/bundle.js:16, 27`). Changing settings later does not change a file that was already exported.
- The exported file shows the player only. It has no settings form. Playback controls show when `controls` is `true`.
- Keep turns removes events outside the range from `timeline.json` and from the export (`src/cli/parse.js:233-236`).
- Play turns sets `turns` in the config. It limits playback only. The export still contains every event, so hidden turns stay in the file. Use Keep turns to remove them.
- The exported file has no CSP tag. The CSP applies to the studio page only (`src/cli/bundle.js:17-34`).

## Embed

The element imports `./config.js`, `./format.js`, `./schedule.js` and `./styles.js`. Serve the whole `src/player/` directory with the page.

```html
<script type="module" src="src/player/claude-replay.js"></script>
<claude-replay src="showcases/sample/timeline.json" config='{"theme":"light"}'></claude-replay>
```

The timeline comes from the first of these sources that is set:

1. The `timeline` property.
2. An inline child `<script type="application/json" data-timeline>`.
3. The `src` attribute, fetched over HTTP.

Inline form. Replace `<` with `\u003c` inside the JSON so the text cannot close the script tag. The bundler does the same.

```html
<claude-replay>
  <script type="application/json" data-timeline>{"version":1,"meta":{...},"events":[...]}</script>
</claude-replay>
```

### Attributes

| Name | Direction | Meaning |
|------|-----------|---------|
| `src` | input | URL of a `timeline.json`. Changing it after load reloads the timeline. |
| `config` | input | Partial config as a JSON string. Invalid JSON is treated as `{}`. |
| `state` | output | `loading`, `ready`, `playing`, `paused`, `ended` or `error`. Starts as `loading`. |
| `theme` | output | Set from `config.theme`. Change `config.theme` instead; the element rewrites this attribute when it applies the config. |

### Properties and methods

| Member | Meaning |
|--------|---------|
| `timeline` (get, set) | The loaded timeline object. Setting it replaces the timeline and rebuilds the schedule. `null` before load. |
| `config` (get, set) | Set: partial config, merged with the defaults. Get: the full normalized config. |
| `duration` (get) | Schedule length in ms. `0` before load. |
| `currentTime` (get, set) | Position in ms. Setting it calls `seek`. |
| `play()` | Start or resume playback. |
| `pause()` | Pause playback. |
| `restart()` | Seek to `0` and play. |
| `seek(ms)` | Set the position, clamped to `0` through `duration`. |

The element dispatches `statechange` on every state change. `event.detail.state` holds the new state.

A failed load sets `state` to `error` and shows `Failed to load timeline: <message>` in the player (`src/player/claude-replay.js:483-494`).

### Styling

Colors are CSS custom properties on `:host`. Rules on the page override them:

```css
claude-replay {
  --cr-accent: #ffaa00;
}
```

Overridable names: `--cr-bg`, `--cr-fg`, `--cr-dim`, `--cr-accent`, `--cr-prompt-bg`, `--cr-blue`, `--cr-magenta`, `--cr-cyan`, `--cr-cyan-bright`, `--cr-green`, `--cr-yellow`, `--cr-orange`, `--cr-red`. Defaults for `dark` and `light` are in `src/player/styles.js`.

The element sets these inline, so page CSS cannot override them. Use the config keys instead:

- `--cr-width`, `--cr-height`: `width`, `height`
- `--cr-font`, `--cr-font-size`: `fontFamily`, `fontSize` times `scale`

## Configuration

Defaults are `DEFAULT_CONFIG` in `src/player/config.js`. `normalizeConfig` in the same file merges a partial object into the defaults and never throws:

- Keys not listed below are dropped.
- A non-finite number falls back to the default. A non-boolean for a boolean key falls back to the default.
- A number outside its range is clamped. Integer keys are rounded.
- A string that fails its check (`width`, `height`, `fit`, `theme`, `fontFamily`) falls back to the default.
- Invalid `turns` becomes `null`.

Top-level keys are in backticks. Nested keys use dot notation.

| Key | Default | Range or values | Meaning |
|-----|---------|-----------------|---------|
| `width` | `"100%"` | `auto`, `0`, or a number with `px`, `%`, `em`, `rem`, `vh`, `vw`, `vmin`, `vmax`, `ch`, `pt` | Host width. |
| `height` | `"600px"` | Same as `width` | Host height. |
| `fit` | `"none"` | `none`, `width` | `width` sets the font size so `columns` characters fit the host width. |
| `columns` | `100` | integer 40 to 300 | Columns that must fit when `fit` is `width`. |
| `fontFamily` | `ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace` | string without `;`, `{`, `}`, `<`, `>`, `\` | CSS font family. |
| `fontSize` | `13` | 6 to 48 | Font size in px. Effective size is `fontSize` times `scale` when `fit` is `none`. |
| `scale` | `1` | 0.25 to 4 | Multiplier on `fontSize`. |
| `theme` | `"dark"` | `dark`, `light` | Color palette. |
| `autoplay` | `true` | boolean | Start playback after load. |
| `loop` | `false` | boolean | Restart at the end. When `false`, `state` becomes `ended`. |
| `controls` | `true` | boolean | Show the control bar. |
| `seed` | `1` | integer -2147483648 to 2147483647 | Seed for typing jitter. |
| `speed` | `1` | 0.1 to 20 | Playback rate. Applied live. |
| `turns` | `null` | `null` or `[from, to]`, integers at least 1, `from` at most `to` | Plays only events in these turns (1-based, inclusive). |
| `gapMs` | `150` | 0 to 5000 | Pause after thinking, text, tool and result segments. |
| `typing` | | | Prompt typing. |
| `typing.cps` | `28` | 1 to 100000 | Characters per second before jitter. |
| `typing.jitter` | `0.35` | 0 to 0.9 | Random variation per character. |
| `typing.punctuationPauseMs` | `120` | 0 to 600000 | Extra delay after `.`, `,`, `;`, `:`, `?`, `!`. |
| `typing.maxMs` | `6000` | 0 to 600000 | Cap on typing duration, applied before `multiplier`. |
| `typing.submitPauseMs` | `350` | 0 to 600000 | Pause after typing, before submit. |
| `typing.multiplier` | `1` | 0.05 to 20 | Scales typing duration. |
| `thinking` | | | Thinking segments. |
| `thinking.scale` | `0.25` | 0 to 100 | Scales the transcript thinking duration. |
| `thinking.minMs` | `800` | 0 to 600000 | Minimum thinking duration. |
| `thinking.maxMs` | `4000` | 0 to 600000 | Maximum thinking duration. |
| `thinking.multiplier` | `1` | 0.05 to 20 | Scales thinking duration. |
| `tool` | | | Tool wait segments. |
| `tool.scale` | `0.25` | 0 to 100 | Scales the tool duration from the transcript. |
| `tool.minMs` | `400` | 0 to 600000 | Minimum wait. |
| `tool.maxMs` | `3000` | 0 to 600000 | Maximum wait. |
| `tool.multiplier` | `1` | 0.05 to 20 | Scales wait. |
| `output` | | | Streamed assistant text. |
| `output.cps` | `600` | 1 to 100000 | Characters per second. |
| `output.maxMs` | `2500` | 0 to 600000 | Maximum streaming duration. |
| `output.multiplier` | `1` | 0.05 to 20 | Scales streaming duration. |
| `results` | | | Tool results. |
| `results.show` | `true` | boolean | `false` hides tool results. |
| `results.lines` | `3` | integer 0 to 50 | Result lines shown before the `… +N lines` line. |
| `header` | | | Header block. |
| `header.show` | `true` | boolean | Show the header. |
| `header.billing` | `null` | string or `null` | Text after `· ` on the model line. Not in transcripts, so unset by default. |
| `status` | | | Status line overrides. |
| `status.project` | `null` | string or `null` | Overrides the transcript project. `null` or empty uses the transcript value. |
| `status.branch` | `null` | string or `null` | Overrides the transcript branch. |
| `status.model` | `null` | string or `null` | Overrides the transcript model. |
| `status.effort` | `null` | string or `null` | Overrides the transcript effort. |
| `status.contextWindow` | `1000000` | integer 1000 to 1000000000 | Denominator for the context percentage. |
| `status.compactions` | `0` | integer 0 to 1000000 | Value shown after `⟳`. |

### Timing

Schedule durations are in ms at `speed` 1. `speed` scales elapsed real time and applies live, without a rebuild (`src/player/claude-replay.js:506-510`).

- **Typing** (`prompt`): for each character, `delay = (1000 / typing.cps) × (1 + typing.jitter × (2r - 1))`. `r` comes from a PRNG seeded by `seed` (mulberry32). Add `typing.punctuationPauseMs` after each of `.,;:?!`. If the sum exceeds `typing.maxMs`, scale all delays by `maxMs / sum`. Multiply by `typing.multiplier`. Then wait `typing.submitPauseMs` (`src/player/schedule.js:39-57, 87-90`).
- **Thinking**: `clamp(durationMs × thinking.scale, thinking.minMs, thinking.maxMs) × thinking.multiplier`. `durationMs` is the transcript's thinking duration (`src/player/schedule.js:91-94`).
- **Tool wait** (`tool_use`): `clamp(durationMs × tool.scale, tool.minMs, tool.maxMs) × tool.multiplier`. `durationMs` is the time from the tool call to its result, or `0` when unknown (`src/player/schedule.js:99-102`; `src/cli/parse.js:126`).
- **Text**: `min(text length / output.cps × 1000, output.maxMs) × output.multiplier` (`src/player/schedule.js:95-98`).
- **Tool result**: no duration. Omitted when `results.show` is `false` (`src/player/schedule.js:72, 103-104`).
- **Gaps**: `gapMs` follows every segment except typing. After typing comes only the submit pause (`src/player/schedule.js:73-90`).
- **Turns**: events outside `turns` are not scheduled (`src/player/schedule.js:68-70`).

Changing any config key other than `speed` rebuilds the schedule. Playback keeps the same fraction of the total length (`src/player/claude-replay.js:299-311, 496-504`).

## CLI

Run from the repo root with Node.js 20 or later:

```text
node bin/claude-replay.js parse <transcript.jsonl> -o <timeline.json> [options]
node bin/claude-replay.js bundle <timeline.json> -o <out.html> [options]
node bin/claude-replay.js studio -o <out.html>
node bin/claude-replay.js --help
```

`parse` and `bundle` take exactly one input file. `studio` takes none. All three create missing parent directories for the output (`bin/claude-replay.js:108, 160, 193`).

### parse

| Flag | Meaning |
|------|---------|
| `-o, --out <file>` | Output timeline JSON. Required. |
| `--turns <A-B>` | Keep turns A through B, 1-based and inclusive. Requires `1 <= A <= B`. Turn numbers keep their original values. |
| `--thinking-text` | Keep thinking text in the timeline. Off by default. |
| `--max-result-lines <N>` | Maximum lines kept per tool result. Default `20`. Non-negative integer. `totalLines` still counts all lines. |
| `--redact <regex>` | Extra pattern; each match becomes `<redacted>`. Repeatable. Compiled as a JavaScript regex with flag `g`. |
| `--title <text>` | Sets `meta.title`. |
| `-h, --help` | Print usage and exit 0. |

Regenerate the committed sample from the synthetic fixture:

```bash
node bin/claude-replay.js parse test/fixtures/session.jsonl -o showcases/sample/timeline.json --title "claude-replay sample"
```

On success, `parse` prints `wrote <out>: <E> events, <T> turns, <R> redactions` to stdout. It prints `warning: skipped <N> malformed lines` to stderr when lines fail to parse. It always prints `review output before publishing: redaction is pattern-based` to stderr.

### bundle

| Flag | Meaning |
|------|---------|
| `-o, --out <file>` | Output HTML file. Required. |
| `--config <file>` | Partial player config JSON to embed. Embedded as given; the player normalizes it on load. Default `{}`. |
| `--title <text>` | Page `<title>`. |
| `-h, --help` | Print usage and exit 0. |

The output has the player code inline, the timeline in a `data-timeline` script, and the config in the `config` attribute. It has no `src`, `href`, `<link>`, or imports (`src/cli/bundle.js:13-35`). It contains no timestamps, so repeated runs produce the same bytes.

`bundle` reads the player files from `src/player/` next to `bin/`. Run it from this checkout.

On success, `bundle` prints one `wrote <out>` line with the output size.

### studio

| Flag | Meaning |
|------|---------|
| `-o, --out <file>` | Output studio HTML. Required. |
| `-h, --help` | Print usage and exit 0. |

`studio` takes no input file. It builds the studio from `demo/index.html`, the player files in `src/player/`, the parser, redaction and bundler in `src/cli/`, `src/studio/studio.js`, `demo/demo.js`, and the sample `showcases/sample/timeline.json` (`bin/claude-replay.js:127, 175, 186-191`). The same inputs give the same bytes, so the committed `index.html` can be checked against a fresh build (test `studio artifact is regenerable`, `test/studio-build.test.js:89`).

`npm run build` runs `node bin/claude-replay.js studio -o index.html` (`package.json` `scripts.build`). See [Development](#development) for when to rebuild.

On success, `studio` prints one `wrote <out>` line with the output size.

### Exit codes

| Code | Meaning |
|------|---------|
| `0` | Success, or `-h` / `--help`. |
| `1` | Runtime error, such as an unreadable input or an unwritable output. Printed as `error: <message>`, for example `cannot read <path>: <reason>`. |
| `2` | Usage error: missing or unknown command, unknown option, missing input or `-o`, bad `--turns`, bad `--max-result-lines`, invalid `--redact` regex, or an input file given to `studio`. The message and usage text go to stderr. |

## Privacy and redaction

A transcript holds prompts, file contents, command output and tool results. Redaction is pattern-based and is not a guarantee. Review every timeline before you commit or publish it.

Claude Code session transcripts are under `~/.claude/projects/`, one `.jsonl` file per session.

### What is redacted

Rules run in this order on every string in `meta` and `events` (`src/cli/redact.js:36-63, 82-90`):

1. Home directories: `/Users/<name>`, `/home/<name>` and `C:\Users\<name>` become `~`.
2. The OS user running the CLI, as a whole word of 3 or more characters, becomes `<user>`. The studio cannot read the OS user, so it takes the name from the first `cwd` in the transcript that starts with `/Users/<name>`, `/home/<name>` or `C:\Users\<name>`. If no `cwd` matches, this rule does not run (`src/studio/studio.js:5-6, 40-43`).
3. Secret-shaped tokens become `<redacted>`: `sk-ant-` and `sk-` keys, GitHub tokens (`gh[pousr]_`, `github_pat_`), AWS access key IDs (`AKIA`), Slack tokens (`xox[abprs]-`), and JWTs.
4. `Bearer <token>` becomes `Bearer <redacted>`.
5. Values of uppercase names containing `KEY`, `TOKEN`, `SECRET`, `PASSWORD`, `PASSWD` or `CREDENTIAL` become `<redacted>`. The name and separator stay: `API_KEY=abcd1234` becomes `API_KEY=<redacted>`.
6. Email addresses become `<email>`.
7. IPv4 addresses become `<ip>`.
8. Each `--redact` pattern becomes `<redacted>`.

`parse` reports the total replacement count as `<R> redactions`.

Content is also removed or shortened, not redacted:

- Thinking text is dropped unless `--thinking-text` is set (`src/cli/parse.js:178`; `bin/claude-replay.js:89`).
- Tool results keep only the first `--max-result-lines` lines (default 20) (`src/cli/parse.js:18, 119-123`).
- Tool summaries keep only the first line of a Bash command and at most 120 characters (`src/cli/parse.js:17, 36-37`).

### Not redacted

- Internal hostnames and domain names. No rule matches them.
- Personal names, client names and project names in prompts, text and tool output.
- Paths outside `/Users/`, `/home/` and `C:\Users\`, for example `/srv/...`.
- Lowercase names such as `api_key=...`. The name rule matches uppercase only.
- Secrets in formats not listed above.
- Other accounts' names in prose.

### Review checklist

- [ ] Write the timeline under `private/` first. `private/` is git-ignored (`.gitignore` line 2).
- [ ] Read `meta` and every `prompt`, `text`, `tool_use` and `tool_result` event for hostnames, names and project names.
- [ ] For each known name or host, run `grep -niE "<term>" private/<name>/timeline.json`. Expect no output.
- [ ] For each miss, re-run `parse` with `--redact "<regex>"` and check again.
- [ ] Leave `--thinking-text` off unless the thinking text was reviewed.
- [ ] Never commit raw `.jsonl` transcripts.
- [ ] Review the timeline before `bundle`. The bundled HTML embeds the whole timeline (`src/cli/bundle.js:15-28`).
- [ ] Review in the studio before Export or Download. The exported HTML embeds the whole timeline, including turns hidden by Play turns.

## Timeline format

`parse` and the studio's Download timeline.json write this format. The player, `bundle` and the studio read it. Schema version 1.

```text
{
  "version": 1,
  "meta": { ... },
  "events": [ ... ]
}
```

### meta

| Field | Type | Source |
|-------|------|--------|
| `title` | string or null | `--title` |
| `claudeVersion` | string or null | `version` of the first user or assistant entry |
| `model` | string or null | `identity.marketingName` of the first `model` attachment; else `message.model` of the first assistant entry |
| `modelId` | string or null | `identity.modelId` of the first `model` attachment; else `message.model` of the first assistant entry |
| `effort` | string or null | `effort` of the first assistant entry |
| `agent` | string or null | `agentSetting` of the first `agent-setting` entry |
| `cwd` | string or null | `cwd` of the first user or assistant entry, after redaction (for example `~/...`) |
| `project` | string or null | Last path segment of `cwd` |
| `branch` | string or null | `gitBranch` of the first user or assistant entry |
| `isWorktree` | boolean | `snapshot.isWorktree` of the `environment` attachment; `false` by default |
| `permissionMode` | string or null | First `permission-mode` entry, or a typed user entry |
| `durationMs` | number | `t` of the last event |

Source: `src/cli/parse.js:211-266`.

### events

Every event has `type`, `t` and `turn`:

- `t`: ms since the first kept event. Never decreases.
- `turn`: 1-based. Each prompt starts a new turn. Events before the first prompt are dropped (`src/cli/parse.js:109-112, 233-241`).

| `type` | Fields |
|--------|--------|
| `prompt` | `text`. Typed prompts and slash commands (`/name args`). Dropped: `/clear`, `isMeta` entries, local command output, task notifications, and non-human origins (`src/cli/parse.js:57-68, 141, 155`). |
| `thinking` | `durationMs`. `text` only with `--thinking-text`. |
| `text` | `text`, markdown source. |
| `tool_use` | `id` (`t1`, `t2`, ... in order), `name`, `summary`. `durationMs` when the matching result is found. |
| `tool_result` | `toolUseId`, `isError`, `lines`, `totalLines`. Results with no matching `tool_use` are dropped. |

`thinking`, `text` and `tool_use` also have an optional `contextTokens`: input, cache creation and cache read tokens of the API message (`src/cli/parse.js:40-43, 168`).

The player checks only `version` (must be `1`), that `events` is an array, and each event's `type`. Other fields fall back to defaults (`src/player/schedule.js:6-17`).

## Deploy to GitHub Pages

The repo root is the Pages site. Pages serves committed files as they are. `index.html` is committed build output, so run `npm run build` before you commit a change to any file it reads (see [Development](#development)).

1. Commit to `main`. Do not commit unreviewed timelines.
2. In repository Settings, open Pages. Under Build and deployment, set Source to "Deploy from a branch", Branch to `main`, and folder to `/ (root)`.
3. Pages URLs:
   - Studio: `https://<owner>.github.io/<repo>/`
   - Demo (dev page, Export disabled): `https://<owner>.github.io/<repo>/demo/`
   - Showcase: `https://<owner>.github.io/<repo>/showcases/<name>/`

The root has no `index.html`, so `https://<owner>.github.io/<repo>/` has no page. Everything committed under the root is published, including `showcases/*/timeline.json`.

## New showcase

A showcase is one `index.html` under `showcases/<name>/`. Use path A (studio) or path B (CLI).

Path A, studio:

1. Open `index.html` and load the transcript. Set the Title and parser options if needed.
2. Review the redaction count and the replay. See [Privacy and redaction](#privacy-and-redaction).
3. Set the player settings. Click `Export showcase HTML`. The download is named after the title, for example `my-demo.html`.
4. Save the file as `showcases/<name>/index.html` and commit it. Do not commit raw `.jsonl` transcripts.

Path B, CLI:

1. Parse the transcript into `private/`:

   ```bash
   node bin/claude-replay.js parse ~/.claude/projects/<project-slug>/<session-id>.jsonl -o private/<name>/timeline.json --title "<title>"
   ```

2. Review the timeline. See [Privacy and redaction](#privacy-and-redaction).
3. Bundle it:

   ```bash
   node bin/claude-replay.js bundle private/<name>/timeline.json -o showcases/<name>/index.html --title "<title>"
   ```

   `--config <file>` embeds a partial config for this showcase.

4. Commit `showcases/<name>/index.html`. Do not commit `private/`.

Both paths use `buildShowcaseHtml` (`src/cli/bundle.js:13-35`). The HTML is self-contained, so the folder can move and the file opens from `file://`.

## Development

- Node.js 20 or later (`package.json` `engines`). The code uses `node:test` and `util.parseArgs`.
- `npm test` runs `node --test` (`package.json` `scripts.test`). The CLI tests write only under the OS temp directory (`test/cli.test.js`).
- `npm run build` regenerates `index.html` (`package.json` `scripts.build`). Run it after changing any file the build reads: `src/player/*.js`, `src/cli/redact.js`, `src/cli/parse.js`, `src/cli/bundle.js`, `src/studio/studio.js`, `demo/index.html`, `demo/demo.js`, `showcases/sample/timeline.json`, or the builder `src/cli/build-studio.js` (`bin/claude-replay.js:127, 175, 186-191`). Commit the regenerated file. The test `studio artifact is regenerable` (`test/studio-build.test.js:89`) fails when the committed file is stale.
- `npm run serve` serves the repo root on port 8730 (`package.json` `scripts.serve`). Open `http://localhost:8730/demo/` for the dev page.
- No runtime or dev dependencies. `package.json` has no `dependencies` or `devDependencies`.
- Layout:
  - `bin/claude-replay.js`: CLI. The only non-test file that reads or writes files.
  - `src/cli/`: `redact.js`, `parse.js`, `bundle.js`, `build-studio.js`. Pure functions.
  - `src/player/`: `config.js`, `format.js`, `schedule.js`, `styles.js`, `claude-replay.js`. Only `claude-replay.js` touches the DOM.
  - `src/studio/`: `studio.js`. Pure functions for the studio page: input reading, parser options, export file name, embed snippet.
  - `demo/`: studio page source (`index.html`, `demo.js`). Served as the dev page at `/demo/`.
  - `index.html`: generated by `npm run build`. Do not edit by hand.
  - `showcases/sample/`: generated from `test/fixtures/session.jsonl`, a synthetic transcript.
  - `test/`: `node:test` suites and fixtures.
- Files inlined into the studio (`src/player/*.js`, `src/cli/redact.js`, `src/cli/parse.js`, `src/cli/bundle.js`, `src/studio/studio.js`, `demo/demo.js`) must use one-line `import` statements ending in `;`, and `export function`, `export const` or `export class` declarations. The bundler strips only these forms, with line-based regexes (`src/cli/bundle.js:7-11`). Other `import` or `export` forms are embedded unchanged, which can break the single script. Top-level names must be unique across all of these files. The builder escapes `</script` in the inlined code (`src/cli/build-studio.js:21`).
- Do not add comments to source files. Record design notes in this README.
- No formatter, linter or type checker is configured. The project has no dev dependencies, so `npm test` is the only automated check.

## Limitations

- Visuals approximate the reference screenshot. They are not pixel-exact. Glyphs (`❯ ⏺ ⎿ ✻ ⏵⏵`) depend on installed fonts.
- Subagent internals are not rendered. Entries with `isSidechain` set to `true` are skipped, and `subagents/*.jsonl` files are not read (`src/cli/parse.js:205`). An `Agent` tool call shows `subagent_type: description`. A background launch shows `Running in background` (`src/cli/parse.js:30-31, 118`).
- Startup warnings and notices are not replayed. The parser ignores `system` entries (`src/cli/parse.js:3`).
- The header billing line (`API Usage Billing` in the original CLI) is not in transcripts. Set `header.billing` to show it.
- The status line timer `⏱` shows the session time from the transcript, not the replay clock (`src/player/format.js:61`; `src/player/claude-replay.js:557`).
- Thinking text is not included unless `--thinking-text` is set, or Include thinking text is checked in the studio.
- The transcript format is undocumented here and may change between Claude Code versions. Field names were observed in Claude Code 2.1.308 transcripts. The parser reads every field with a fallback.
- The dev page at `demo/` needs an HTTP server and has no Export. See [Quick start](#quick-start).
- MP4 and GIF export are not provided.
- The studio was checked only in headless Chromium (Chrome headless shell). Downloads and clipboard copy were not tested headless. Safari and Firefox `file://` behavior is not verified.
- The studio parses transcripts on the main thread. Large transcripts can pause the page.
- Play turns hides turns but keeps them in the export. Use Keep turns to remove them (see [Studio](#studio)).
