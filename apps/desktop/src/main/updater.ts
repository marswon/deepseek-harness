import { dialog, shell } from 'electron'
import pkg from 'electron-updater'

const { autoUpdater } = pkg

/**
 * Where manual macOS updates are downloaded from. Keep in sync with the
 * publish config in electron-builder.yml.
 */
const RELEASES_URL = 'https://github.com/marswon/deepseek-harness/releases'

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
 * electron-builder.yml. On Windows the download happens automatically and the
 * user chooses when to restart; on macOS (ad-hoc signed builds) the user is
 * sent to the release page instead — see below. A manual check reports
 * "up to date" when nothing is found.
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
  autoUpdater.on('update-not-available', () => {
    void dialog.showMessageBox({ message: 'DeepSeek Harness is up to date.' })
  })
  const check = (): void => {
    autoUpdater.checkForUpdates().catch((error: unknown) => {
      options.log(`update check failed: ${error instanceof Error ? error.message : String(error)}`)
    })
  }

  if (process.platform === 'darwin') {
    // Local macOS builds are ad-hoc signed, whose designated requirement is a
    // per-binary cdhash — Squirrel.Mac therefore rejects every update at
    // install time, after downloading ~200 MB. Skip the download and point at
    // the release page instead. Revisit if a Developer ID signature is added.
    autoUpdater.autoDownload = false
    autoUpdater.on('update-available', (info) => {
      void dialog
        .showMessageBox({
          type: 'info',
          message: `Version ${info.version} is available`,
          detail: 'This build cannot update itself on macOS. Download the new version and drag it over the old one.',
          buttons: ['Download', 'Later'],
        })
        .then(({ response }) => {
          if (response === 0) void shell.openExternal(`${RELEASES_URL}/tag/v${info.version}`)
        })
    })
    return check
  }

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
  return check
}
