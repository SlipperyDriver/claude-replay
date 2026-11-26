import { stripModuleSyntax } from './bundle.js';

const CHARSET_MARKER = '<meta charset="utf-8">';
const SAMPLE_MARKER = ' src="../showcases/sample/timeline.json"></claude-replay>';
const SCRIPT_MARKER = '<script type="module" src="./demo.js"></script>';
const CSP_META = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'">`;

function json(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function replaceOnce(text, marker, replacement) {
  if (text.split(marker).length !== 2) throw new Error(`studio shell: expected exactly one ${marker}`);
  return text.split(marker).join(replacement);
}

export function buildStudioHtml({ shellHtml, sampleTimeline, playerSources, appSources }) {
  const code = [...playerSources, ...appSources]
    .map(stripModuleSyntax)
    .join('\n')
    .replace(/<\/script/gi, '<\\/script');
  let html = replaceOnce(shellHtml, CHARSET_MARKER, `${CHARSET_MARKER}\n${CSP_META}`);
  html = replaceOnce(html, SAMPLE_MARKER, `><script type="application/json" data-timeline>${json(sampleTimeline)}</script></claude-replay>`);
  html = replaceOnce(
    html,
    SCRIPT_MARKER,
    `<script type="application/json" id="player-sources">${json(playerSources)}</script>\n<script type="module">\n${code}\n</script>`,
  );
  return html;
}
