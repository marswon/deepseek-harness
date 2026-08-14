/** Actions the shell page can request through the preload bridge. */
export type ShellAction = 'retry' | 'view-logs' | 'quit'

/** State the built-in shell page renders. */
export type ShellPageState =
  | { readonly status: 'starting' }
  | { readonly status: 'failed'; readonly message: string; readonly logTail: readonly string[] }

/** Escape text for safe interpolation into the shell page HTML. */
function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/**
 * Render the shell page shown before the Harness UI is reachable: a spinner
 * while starting, or the failure message with a log tail and recovery actions
 * (retry / view logs / quit) wired through `window.dshDesktop.shellAction`.
 * @param state - which variant to render.
 * @returns a self-contained HTML document; no network references.
 */
export function renderShellPage(state: ShellPageState): string {
  const body = state.status === 'starting'
    ? `<div class="spinner" aria-label="starting"></div>
       <p>Starting DeepSeek Harness…</p>`
    : `<h1>Harness failed to start</h1>
       <p class="message">${escapeHtml(state.message)}</p>
       ${state.logTail.length > 0 ? `<pre>${escapeHtml(state.logTail.join('\n'))}</pre>` : ''}
       <div class="actions">
         <button data-action="retry">Retry</button>
         <button data-action="view-logs">View Logs</button>
         <button data-action="quit">Quit</button>
       </div>`
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>DeepSeek Harness</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #1b1d21; color: #e6e6e6; }
  main { max-width: 640px; padding: 32px; text-align: center; }
  pre { text-align: left; background: #101216; padding: 12px; border-radius: 6px; overflow: auto; max-height: 240px; font-size: 12px; }
  .message { color: #f0a3a3; }
  .actions { display: flex; gap: 12px; justify-content: center; margin-top: 16px; }
  button { background: #2f6fed; color: #fff; border: 0; border-radius: 6px; padding: 8px 20px; font-size: 14px; cursor: pointer; }
  button:hover { background: #255bc4; }
  .spinner { width: 32px; height: 32px; margin: 0 auto 16px; border: 3px solid #3a3f47; border-top-color: #2f6fed; border-radius: 50%; animation: spin 0.9s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
<main>${body}</main>
<script>
  document.querySelectorAll('[data-action]').forEach(button => {
    button.addEventListener('click', () => window.dshDesktop?.shellAction(button.dataset.action))
  })
</script>
</body>
</html>`
}
