export const STYLES = `
:host{display:block;box-sizing:border-box;width:var(--cr-width,100%);height:var(--cr-height,600px);overflow:hidden}
:host,:host([theme="dark"]){--cr-bg:#000;--cr-fg:#e8e8e8;--cr-dim:#8a8a8a;--cr-accent:#e0867f;--cr-prompt-bg:#262626;--cr-blue:#7fb2ff;--cr-magenta:#d98cf0;--cr-cyan:#5fd7e6;--cr-cyan-bright:#8ff0ff;--cr-green:#5fd75f;--cr-yellow:#ffd700;--cr-orange:#ff9f43;--cr-red:#ff5f5f;--cr-font:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;--cr-font-size:13px}
:host([theme="light"]){--cr-bg:#fafafa;--cr-fg:#1f1f1f;--cr-dim:#6b6b6b;--cr-accent:#c9605a;--cr-prompt-bg:#ececec;--cr-blue:#1f5fbf;--cr-magenta:#a63fa6;--cr-cyan:#0b7a8c;--cr-cyan-bright:#0098b0;--cr-green:#1e8a2e;--cr-yellow:#9a7400;--cr-orange:#c25e00;--cr-red:#c62828}
[hidden]{display:none!important}
.cr-root{display:flex;flex-direction:column;height:100%;background:var(--cr-bg);color:var(--cr-fg)}
.cr-screen{position:relative;flex:1;min-height:0;display:flex;flex-direction:column;box-sizing:border-box;padding:6px 8px;overflow:hidden;font-family:var(--cr-font);font-size:var(--cr-font-size);line-height:1.4}
.cr-probe{position:absolute;left:0;top:0;visibility:hidden;pointer-events:none;white-space:pre;font-size:100px}
.cr-header{display:flex;flex:none;align-items:flex-start;gap:1.2ch;margin-bottom:.7em;white-space:pre}
.cr-logo{flex:none;width:3.6em;height:2.4em;shape-rendering:crispEdges}
.cr-logo rect{fill:var(--cr-accent)}
.cr-history{flex:1;min-height:0;overflow-y:auto;scrollbar-width:thin;scrollbar-color:var(--cr-dim) transparent}
.cr-row{display:flex}
.cr-history>.cr-row:not(.cr-result){margin-top:.7em}
.cr-history>:first-child{margin-top:0}
.cr-prompt{background:var(--cr-prompt-bg)}
.cr-mark{flex:none;white-space:pre}
.cr-body{flex:1;min-width:0;white-space:pre-wrap;overflow-wrap:anywhere}
.cr-block>*+*{margin-top:1.4em}
.cr-block>.cr-bullet+.cr-bullet{margin-top:0}
.cr-bullet{padding-left:2ch;text-indent:-2ch}
.cr-heading{font-weight:bold}
.cr-code{margin:0;padding:.4em .8ch;background:var(--cr-prompt-bg);font:inherit;white-space:pre-wrap;overflow-wrap:anywhere}
.cr-body code{color:var(--cr-cyan)}
.cr-wait{color:var(--cr-dim);animation:cr-blink 1s steps(1) infinite}
.cr-error{color:var(--cr-red)}
.cr-input{flex:none;margin-top:.7em}
.cr-rule{display:flex;align-items:center;color:var(--cr-dim)}
.cr-rule-line{flex:1;border-top:1px solid var(--cr-dim)}
.cr-rule-label{flex:none;padding:0 .6ch}
.cr-rule-tail{flex:none;width:1ch;border-top:1px solid var(--cr-dim)}
.cr-unlabeled .cr-rule-label,.cr-unlabeled .cr-rule-tail{display:none}
.cr-input-row{min-height:1.4em}
.cr-cursor{display:inline-block;width:1ch;height:1.1em;vertical-align:text-bottom;background:var(--cr-fg);animation:cr-blink 1s steps(1) infinite}
.cr-status,.cr-footer{flex:none;white-space:nowrap;overflow:hidden}
.cr-status{margin-top:.3em}
.cr-dim{color:var(--cr-dim)}
.cr-accent{color:var(--cr-accent)}
.cr-blue{color:var(--cr-blue)}
.cr-magenta{color:var(--cr-magenta)}
.cr-cyan{color:var(--cr-cyan)}
.cr-cyan-bright{color:var(--cr-cyan-bright)}
.cr-green{color:var(--cr-green)}
.cr-yellow{color:var(--cr-yellow)}
.cr-orange{color:var(--cr-orange)}
.cr-red{color:var(--cr-red)}
.cr-controls{display:flex;flex:none;align-items:center;gap:8px;box-sizing:border-box;padding:6px 8px;border-top:1px solid var(--cr-dim);background:var(--cr-bg);color:var(--cr-fg);font:12px/1 ui-monospace,Menlo,Consolas,monospace}
.cr-btn,.cr-speed{border:1px solid var(--cr-dim);border-radius:4px;background:transparent;color:inherit;font:inherit}
.cr-btn{padding:4px 8px;cursor:pointer}
.cr-speed{padding:3px;background:var(--cr-bg)}
.cr-scrub{flex:1;min-width:0;accent-color:var(--cr-accent)}
.cr-time{flex:none;color:var(--cr-dim);white-space:nowrap}
@keyframes cr-blink{0%,49%{opacity:1}50%,100%{opacity:0}}
`;
