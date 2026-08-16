import { app, dialog, Menu, shell } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'

/** Actions the application menu triggers, supplied by the app shell. */
export interface MenuActions {
  /** Restart the Harness child process. */
  readonly restartHarness: () => void
  /** Reveal the Harness log file. */
  readonly viewLogs: () => void
  /** Run an electron-updater check and report through a dialog. */
  readonly checkForUpdates: () => void
}

/**
 * Install the application menu. Keeps platform conventions: an app menu on
 * macOS, File/View/Help elsewhere.
 * @param actions - menu callbacks.
 * @param dataDir - the desktop data root shown by Open Data Folder.
 */
export function installMenu(actions: MenuActions, dataDir: string): void {
  const template: MenuItemConstructorOptions[] = []
  if (process.platform === 'darwin') {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Check for Updates…', click: actions.checkForUpdates },
        { type: 'separator' },
        { role: 'quit' },
      ],
    })
  }
  template.push(
    {
      label: 'Harness',
      submenu: [
        { label: 'Restart Harness', click: actions.restartHarness },
        { label: 'View Harness Log', click: actions.viewLogs },
        { label: 'Open Data Folder', click: () => void shell.openPath(dataDir) },
        ...(process.platform === 'darwin'
          ? []
          : [
            { type: 'separator' } as MenuItemConstructorOptions,
            { label: 'Check for Updates…', click: actions.checkForUpdates },
            // Windows/Linux have no About role — show the version ourselves.
            {
              label: 'About DeepSeek Harness',
              click: () => {
                void dialog.showMessageBox({
                  type: 'info',
                  message: 'DeepSeek Harness',
                  detail: `Version ${app.getVersion()}`,
                  buttons: ['OK'],
                })
              },
            },
          ]),
      ],
    },
    {
      // The Edit roles are what drive Cmd+C/V/X/A in text fields on every
      // platform; without this menu the web UI cannot be pasted into.
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }],
    },
  )
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
