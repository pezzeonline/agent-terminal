export interface TerminalHtmlConfig {
  xtermVersion: string
  fitAddonVersion: string
  webLinksAddonVersion: string
  initialCols: number
  initialRows: number
  fontFamily: string
  fontSize: number
  scrollback: number
  themeBackground: string
  themeForeground: string
  themeCursor: string
}

export const DEFAULT_TERMINAL_HTML_CONFIG: TerminalHtmlConfig = {
  xtermVersion: '6.0.0',
  fitAddonVersion: '0.11.0',
  webLinksAddonVersion: '0.12.0',
  initialCols: 80,
  initialRows: 24,
  fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  fontSize: 12,
  scrollback: 2000,
  themeBackground: '#0e0f10',
  themeForeground: '#e6e8eb',
  themeCursor: '#e6e8eb',
}

export function buildTerminalHtml(config: TerminalHtmlConfig): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/@xterm/xterm@${config.xtermVersion}/css/xterm.css">
<style>
  html, body { margin: 0; padding: 0; height: 100%; width: 100%; background: ${config.themeBackground}; overflow: hidden; }
  #terminal { position: absolute; inset: 0; }
</style>
</head>
<body>
<div id="terminal"></div>
<script src="https://unpkg.com/@xterm/xterm@${config.xtermVersion}/lib/xterm.js"></script>
<script src="https://unpkg.com/@xterm/addon-fit@${config.fitAddonVersion}/lib/addon-fit.js"></script>
<script src="https://unpkg.com/@xterm/addon-web-links@${config.webLinksAddonVersion}/lib/addon-web-links.js"></script>
<script>
(function () {
  function post(msg) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(msg));
    }
  }

  function boot() {
    if (!window.Terminal || !window.FitAddon || !window.WebLinksAddon) {
      setTimeout(boot, 50);
      return;
    }
    var term = new window.Terminal({
      cols: ${config.initialCols},
      rows: ${config.initialRows},
      fontFamily: ${JSON.stringify(config.fontFamily)},
      fontSize: ${config.fontSize},
      cursorBlink: true,
      scrollback: ${config.scrollback},
      theme: {
        background: ${JSON.stringify(config.themeBackground)},
        foreground: ${JSON.stringify(config.themeForeground)},
        cursor: ${JSON.stringify(config.themeCursor)},
      },
    });
    var fit = new window.FitAddon.FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new window.WebLinksAddon.WebLinksAddon());
    term.open(document.getElementById('terminal'));

    term.onData(function (data) { post({ type: 'data', payload: data }); });
    term.onResize(function (e) { post({ type: 'resize', cols: e.cols, rows: e.rows }); });

    fit.fit();

    var observer = new ResizeObserver(function () { fit.fit(); });
    observer.observe(document.getElementById('terminal'));

    window.__terminal_bridge = {
      write: function (data) { term.write(data); },
      clear: function () { term.clear(); },
      fit: function () { fit.fit(); },
    };

    post({ type: 'ready' });
  }

  boot();
})();
</script>
</body>
</html>`
}
