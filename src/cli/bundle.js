const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

export function stripModuleSyntax(source) {
  return source
    .replace(/^import .*;$/gm, '')
    .replace(/^export (?=function|const|class)/gm, '');
}

export function buildShowcaseHtml({ timeline, config, title, playerSources }) {
  const code = playerSources.map(stripModuleSyntax).join('\n');
  const timelineJson = JSON.stringify(timeline).replace(/</g, '\\u003c');
  const configJson = escapeHtml(JSON.stringify(config ?? {}));
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title ?? '')}</title>`,
    '<style>html,body{margin:0;background:#000}</style>',
    '</head>',
    '<body>',
    `<claude-replay config='${configJson}'>`,
    `<script type="application/json" data-timeline>${timelineJson}</script>`,
    '</claude-replay>',
    `<script type="module">\n${code}\n</script>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}
