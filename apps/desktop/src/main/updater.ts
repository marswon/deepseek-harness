import { app, dialog, net, shell } from 'electron'
import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import pkg from 'electron-updater'
import type { UpdateInfo } from 'electron-updater'

const { autoUpdater } = pkg

/**
 * Where updates are published. Keep in sync with the publish config in
 * electron-builder.yml.
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
  /**
   * Runs before the installer is spawned: stop the Harness child so its
   * bundled node.exe no longer locks files under the install directory, and
   * arm the quit path so the app exits without the graceful-shutdown wait.
   */
  readonly prepareForInstall?: () => Promise<void>
}

/**
 * Wire electron-updater against the GitHub Releases feed configured in
 * electron-builder.yml. electron-updater only checks versions and downloads;
 * the install handoff is owned here because quitAndInstall's
 * spawn-and-quit race with the NSIS running-process gate repeatedly stranded
 * users on a "cannot be closed" prompt:
 * - Windows: the pending installer is spawned detached and the app quits only
 *   after the spawn succeeds, and stale installer processes from earlier
 *   failed attempts are force-stopped first (a zombie holds the per-app
 *   installer mutex, so every later attempt aborts instantly and re-raises
 *   the zombie's own dialog).
 * - macOS: ad-hoc signed builds can never pass Squirrel.Mac's signature
 *   check, so the dmg is downloaded and opened for a manual drag-replace.
 * - Linux: electron-updater's own AppImage/deb install is used as-is (see
 *   {@link setupLinuxUpdater}); only the Harness child is stopped first.
 * A manual check reports "up to date" when nothing is found.
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
    autoUpdater.autoDownload = false
    autoUpdater.on('update-available', (info) => {
      void dialog
        .showMessageBox({
          type: 'info',
          message: `Version ${info.version} is available`,
          detail: 'Download it now? The disk image opens when the download finishes; drag DeepSeek Harness over the old one in Applications.',
          buttons: ['Download', 'Later'],
        })
        .then(({ response }) => {
          if (response === 0) void downloadAndOpenMacUpdate(info.version, options)
        })
    })
    return check
  }

  if (process.platform === 'linux') return setupLinuxUpdater(options)

  // Windows installation is owned by spawnInstallerAfterAppExit(). Leaving this
  // true starts a second silent NSIS process during app.quit(), which races the
  // detached waiter and can relaunch the old version without applying the update.
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.on('update-downloaded', (info) => {
    void dialog
      .showMessageBox({
        type: 'info',
        message: 'Update ready',
        detail: 'A new version has been downloaded. Restart to apply it.',
        buttons: ['Restart', 'Later'],
      })
      .then(({ response }) => {
        if (response !== 0) return
        void installWindowsUpdate(info, options)
      })
  })
  return check
}

/**
 * The packaging format a Linux build was installed from. electron-builder
 * writes `resources/package-type` only for the fpm targets (deb/rpm/pacman);
 * AppImage is electron-updater's default and leaves no marker.
 * @returns the marker's contents, or 'appimage' when absent.
 */
function linuxPackageType(): string {
  try {
    return readFileSync(join(process.resourcesPath, 'package-type'), 'utf8').trim() || 'appimage'
  } catch {
    // No marker file: an AppImage build, which never writes one.
    return 'appimage'
  }
}

/**
 * Wire the Linux update flow. electron-updater already selects
 * AppImageUpdater or DebUpdater from `resources/package-type`, so the install
 * itself needs no custom handoff — unlike Windows, nothing here may touch the
 * NSIS pending-installer path or spawn powershell.exe. Two Linux-only facts
 * shape this branch:
 * - An AppImage that is not running through its own runtime has no `APPIMAGE`
 *   environment variable, so `isUpdaterActive()` is false and
 *   `checkForUpdates()` resolves null without emitting any event. A manual
 *   check would look like a dead menu item, so report it instead.
 * - A deb install runs dpkg through pkexec/sudo, which raises a system
 *   authentication prompt. The restart dialog says so; AppImage replaces the
 *   file in place and needs no elevation.
 * @param options - updater wiring.
 * @returns a manual check function for the menu.
 */
function setupLinuxUpdater(options: UpdaterOptions): () => void {
  const packageType = linuxPackageType()
  const isAppImage = packageType === 'appimage'
  options.log(`linux package type: ${packageType}`)
  // The install is owned by quitAndInstall() below, once the Harness child has
  // been stopped; installing again on quit would run dpkg or the AppImage
  // replacement a second time.
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.on('update-downloaded', (info) => {
    void dialog
      .showMessageBox({
        type: 'info',
        message: 'Update ready',
        detail: isAppImage
          ? `Version ${info.version} has been downloaded. Restart to apply it.`
          : `Version ${info.version} has been downloaded. Restart to apply it; the system will ask for your password to install the package.`,
        buttons: ['Restart', 'Later'],
      })
      .then(async ({ response }) => {
        if (response !== 0) return
        // The Harness child holds the staged runtime open under the data root.
        // Stop it before the installer replaces the application files.
        await (options.prepareForInstall ?? (() => Promise.resolve()))().catch((error: unknown) => {
          options.log(`prepare for install failed: ${error instanceof Error ? error.message : String(error)}`)
        })
        options.log(`installing ${packageType} update: ${info.version}`)
        autoUpdater.quitAndInstall()
      })
  })
  return () => {
    autoUpdater.checkForUpdates().then((result) => {
      if (result !== null) return
      // isUpdaterActive() refused the check; no updater event will follow.
      options.log('update check skipped: this build has no active update feed')
      void dialog.showMessageBox({
        message: 'Updates are not available for this build',
        detail: isAppImage
          ? 'Automatic updates need the AppImage to run through its own runtime. Download the latest AppImage from the releases page instead.'
          : 'This installation cannot check for updates. Install the latest package from the releases page instead.',
        buttons: ['OK'],
      })
    }).catch((error: unknown) => {
      options.log(`update check failed: ${error instanceof Error ? error.message : String(error)}`)
    })
  }
}

/**
 * The pending-installer path electron-updater downloads into
 * (`%LOCALAPPDATA%\<updaterCacheDirName>\pending\<file>`). electron-updater
 * keeps its DownloadedUpdateHelper private, so the path is reconstructed from
 * app-update.yml's updaterCacheDirName plus the same base-cache rule as
 * electron-updater's AppAdapter. Returns null when the layout cannot be
 * resolved, in which case the caller falls back to quitAndInstall.
 * @param info - the downloaded update's metadata.
 * @returns the absolute installer path, or null.
 */
async function pendingInstallerPath(info: UpdateInfo): Promise<string | null> {
  try {
    const yml = await readFile(join(process.resourcesPath, 'app-update.yml'), 'utf8')
    const match = /^updaterCacheDirName:\s*'?([^\n']+)'?\s*$/m.exec(yml)
    // files is the authoritative installer list; path is its deprecated
    // pre-v6 mirror, still the only field older feed metadata populates.
    // oxlint-disable-next-line typescript/no-deprecated -- legacy-feed fallback, see above.
    const fileName = info.files[0]?.url ?? info.path
    const cacheDirName = match?.[1]
    if (cacheDirName === undefined) return null
    const localAppData = process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local')
    return join(localAppData, cacheDirName, 'pending', fileName)
  } catch {
    return null
  }
}

/**
 * Force-stop installer processes still running from the pending directory.
 * An installer that died on its own running-process dialog keeps the per-app
 * installer mutex held, so every later attempt aborts instantly and raises
 * the zombie's stale dialog; clearing them makes the mutex reachable again.
 * @param pendingDir - the updater pending directory.
 */
async function killStaleInstallers(pendingDir: string): Promise<void> {
  const escaped = pendingDir.replace(/'/g, "''")
  const command = 'Get-CimInstance Win32_Process'
    + ` | Where-Object { $_.Path -and $_.Path.StartsWith('${escaped}', 'CurrentCultureIgnoreCase') }`
    + ' | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }'
  await new Promise<void>((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-Command', command], { stdio: 'ignore' })
    child.once('error', () => { resolve() })
    child.once('exit', () => { resolve() })
  })
}

/**
 * Start the NSIS installer only after this Electron process is gone. The
 * installer cannot reliably race `app.quit()`: Windows can keep renderer and
 * utility processes alive after the call returns, which reopens NSIS's
 * running-application dialog. A detached PowerShell waiter has no handles
 * inherited from the app and starts the installer after the process id exits.
 * @param installer - absolute path of the downloaded NSIS executable.
 * @returns whether the waiter process was spawned.
 */
async function spawnInstallerAfterAppExit(installer: string): Promise<boolean> {
  const escapedInstaller = installer.replace(/'/g, "''")
  const command = `while (Get-Process -Id ${String(process.pid)} -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 200 }; `
    + `Start-Process -FilePath '${escapedInstaller}' -ArgumentList @('--updated', '--force-run')`
  return await new Promise<boolean>((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', command], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    child.once('error', () => { resolve(false) })
    child.once('spawn', () => {
      child.unref()
      resolve(true)
    })
  })
}

/**
 * Hand the downloaded update to the NSIS installer: stop the Harness child,
 * clear stale installers, spawn the pending installer detached, and quit only
 * once the spawn succeeds. Falls back to quitAndInstall when the pending
 * installer cannot be located or spawned.
 * @param info - the downloaded update's metadata.
 * @param options - updater wiring.
 */
async function installWindowsUpdate(info: UpdateInfo, options: UpdaterOptions): Promise<void> {
  const installer = await pendingInstallerPath(info)
  const prepare = options.prepareForInstall ?? (() => Promise.resolve())
  await prepare().catch((error: unknown) => {
    options.log(`prepare for install failed: ${error instanceof Error ? error.message : String(error)}`)
  })
  if (installer !== null) {
    await killStaleInstallers(dirname(installer))
    if (existsSync(installer)) {
      if (await spawnInstallerAfterAppExit(installer)) {
        options.log(`installer scheduled after app exit: ${installer}`)
        app.quit()
        return
      }
      options.log(`failed to schedule installer: ${installer}`)
    } else {
      options.log(`pending installer missing: ${installer}`)
    }
  }
  autoUpdater.quitAndInstall()
}

/**
 * Download the macOS dmg for one release and open it for a manual
 * drag-replace. Squirrel.Mac auto-install is not attempted: ad-hoc signed
 * builds carry a per-binary cdhash as their designated requirement, so the
 * signature equality check rejects every update after a ~200 MB download.
 * @param version - the release version to download.
 * @param options - updater wiring.
 */
async function downloadAndOpenMacUpdate(version: string, options: UpdaterOptions): Promise<void> {
  try {
    // Artifact name mirrors the mac artifactName in electron-builder.yml.
    const fileName = `DeepSeek-Harness-${version}-${process.arch}.dmg`
    const dir = join(app.getPath('userData'), 'updates', version)
    await mkdir(dir, { recursive: true })
    const destination = join(dir, fileName)
    options.log(`downloading update: ${fileName}`)
    const response = await net.fetch(`${RELEASES_URL}/download/v${version}/${fileName}`, { redirect: 'follow' })
    if (!response.ok || response.body === null) {
      throw new Error(`update download failed: HTTP ${String(response.status)}`)
    }
    await pipeline(
      // Electron's fetch body types against the DOM stream generics; the
      // byte stream itself is identical, so narrow at the node seam.
      Readable.fromWeb(response.body as unknown as import('node:stream/web').ReadableStream<Uint8Array>),
      createWriteStream(destination),
    )
    options.log(`update downloaded to ${destination}`)
    const openError = await shell.openPath(destination)
    if (openError !== '') throw new Error(`failed to open the disk image: ${openError}`)
    await dialog.showMessageBox({
      type: 'info',
      message: `Version ${version} is ready to install`,
      detail: 'The disk image has opened. Drag DeepSeek Harness onto Applications to replace the old version, then reopen it.',
      buttons: ['OK'],
    })
  } catch (error) {
    options.log(`update download failed: ${error instanceof Error ? error.message : String(error)}`)
    const { response } = await dialog.showMessageBox({
      type: 'error',
      message: 'The update could not be downloaded',
      detail: 'Open the release page to download it manually?',
      buttons: ['Open release page', 'Cancel'],
    })
    if (response === 0) void shell.openExternal(`${RELEASES_URL}/tag/v${version}`)
  }
}
