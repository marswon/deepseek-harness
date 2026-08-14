import { BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { navigationAction } from './navigation.ts'

/** Dependencies the main window needs from the app shell. */
export interface MainWindowOptions {
  /** Directory of the built bundles (lib/); the preload sits under `preload/`. */
  readonly libDir: string
  /** Running Harness loopback URL supplier; null before readiness. */
  readonly harnessUrl: () => string | null
}

/**
 * Create the hardened main window: no Node in the renderer, context isolation
 * and sandbox on, all navigation gated by the loopback/file policy and
 * external http(s) targets handed to the system browser.
 * @param options - window wiring.
 * @returns the created window.
 */
export function createMainWindow(options: MainWindowOptions): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(options.libDir, 'preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  window.once('ready-to-show', () => { window.show() })

  window.webContents.on('will-navigate', (event) => {
    const action = navigationAction(event.url, options.harnessUrl())
    if (action === 'allow') return
    event.preventDefault()
    if (action === 'external') void shell.openExternal(event.url)
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (navigationAction(url, options.harnessUrl()) === 'external') void shell.openExternal(url)
    return { action: 'deny' }
  })
  return window
}
