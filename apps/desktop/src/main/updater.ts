import { dialog } from 'electron'
import pkg from 'electron-updater'

const { autoUpdater } = pkg

/** Wiring for update checks. */
export interface UpdaterOptions {
  /** True only in packaged builds; development runs never check. */
  readonly isPackaged: boolean
  /**
   * True when Resources/app-update.yml exists. electron-builder emits it only
   * for publishable targets, so `--dir` and unsigned local builds lack it.
   */
  readonly updateFeedPresent: boolean
  /** Status sink mirroring the Harness log writer. */
  readonly log: (line: string) => void
}

/**
 * Wire electron-updater against the GitHub Releases feed configured in
 * electron-builder.yml. Download happens automatically; the user chooses when
 * to restart. A manual check reports "up to date" when nothing is found.
 * @param options - updater wiring.
 * @returns a manual check function for the menu.
 */
export function setupAutoUpdater(options: UpdaterOptions): () => void {
  if (!options.isPackaged) {
    return () => {
      void dialog.showMessageBox({ message: 'Updates are only available in packaged builds.' })
    }
  }
  if (!options.updateFeedPresent) {
    options.log('no app-update.yml in resources; update checks disabled for this build')
    return () => {
      void dialog.showMessageBox({ message: 'This build has no update feed configured.' })
    }
  }
  const forward = (level: string) => (message: unknown) => { options.log(`${level}: ${String(message)}`) }
  autoUpdater.logger = { info: forward('info'), warn: forward('warn'), error: forward('error'), debug: () => {} }
  autoUpdater.on('update-downloaded', () => {
    void dialog
      .showMessageBox({
        type: 'info',
        message: 'Update ready',
        detail: 'A new version has been downloaded. Restart to apply it.',
        buttons: ['Restart', 'Later'],
      })
      .then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall()
      })
  })
  const check = (): void => {
    autoUpdater.checkForUpdates().catch((error: unknown) => {
      options.log(`update check failed: ${error instanceof Error ? error.message : String(error)}`)
    })
  }
  autoUpdater.on('update-not-available', () => {
    void dialog.showMessageBox({ message: 'DeepSeek Harness is up to date.' })
  })
  return check
}
