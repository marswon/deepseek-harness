import { app, ipcMain, shell } from 'electron'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HarnessLog } from './harness-log.ts'
import { HarnessProcess } from './harness-process.ts'
import { installMenu } from './menu.ts'
import { ensureDesktopPaths, resolveDesktopPaths } from './paths.ts'
import { buildHarnessLaunch, resolveHarnessRuntime } from './runtime.ts'
import type { RuntimeMode } from './runtime.ts'
import { renderShellPage } from './shell-page.ts'
import type { ShellAction } from './shell-page.ts'
import { setupAutoUpdater } from './updater.ts'
import { createMainWindow } from './window.ts'

/**
 * Desktop shell entry: owns the single BrowserWindow and the Harness child
 * lifecycle, wiring readiness, failure recovery, menu actions, updates, and
 * graceful shutdown together.
 */

const libDir = dirname(fileURLToPath(import.meta.url))

const runtimeMode: RuntimeMode = app.isPackaged
  ? { kind: 'packaged', resourcesPath: process.resourcesPath }
  : {
    kind: 'development',
    repoRoot: resolve(libDir, '../../../..'),
    nodeCommand: process.env['npm_node_execpath'] ?? 'node',
  }

const paths = resolveDesktopPaths(app.getPath('userData'))
const log = new HarnessLog()

let harnessUrl: string | null = null
let stopping = false
let quitting = false

const harness = new HarnessProcess({
  onLine: (line) => { log.write(`[${line.stream}] ${line.text}`) },
  onExit: (code) => {
    log.write(`harness child exited with code ${String(code)}`)
    if (stopping || quitting) return
    harnessUrl = null
    showShellPage({
      status: 'failed',
      message: `The Harness process exited unexpectedly (code ${String(code)}).`,
      logTail: log.recentLines(),
    })
  },
})

function showShellPage(state: Parameters<typeof renderShellPage>[0]): void {
  const window = createMainWindowOnce()
  void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(renderShellPage(state, app.getVersion()))}`)
}

let mainWindow: ReturnType<typeof createMainWindow> | null = null
function createMainWindowOnce(): ReturnType<typeof createMainWindow> {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow
  mainWindow = createMainWindow({ libDir: resolve(libDir, '..'), harnessUrl: () => harnessUrl })
  return mainWindow
}

async function startHarness(): Promise<void> {
  showShellPage({ status: 'starting' })
  stopping = false
  try {
    // Packaged builds stage the runtime under the data root first: the
    // install directory must stay free of running processes so updates can
    // close and replace it (Windows locks a running executable's directory).
    const runtime = await resolveHarnessRuntime(runtimeMode, paths, app.getVersion())
    const url = await harness.start(buildHarnessLaunch(runtime, paths, process.env))
    harnessUrl = url
    log.write(`harness ready at ${url}`)
    await createMainWindowOnce().loadURL(url)
  } catch (error) {
    showShellPage({
      status: 'failed',
      message: error instanceof Error ? error.message : String(error),
      logTail: log.recentLines(),
    })
  }
}

async function restartHarness(): Promise<void> {
  stopping = true
  await harness.stop()
  await startHarness()
}

function handleShellAction(action: ShellAction): void {
  switch (action) {
    case 'retry':
      void restartHarness()
      return
    case 'view-logs':
      void shell.openPath(paths.logFile)
      return
    case 'quit':
      app.quit()
      return
    default:
      throw new Error(`unknown shell action: ${String(action)}`)
  }
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const window = createMainWindowOnce()
    if (window.isMinimized()) window.restore()
    window.focus()
  })

  void app.whenReady().then(async () => {
    await ensureDesktopPaths(paths)
    log.open(paths.logFile)
    log.write(`desktop shell starting (${runtimeMode.kind} mode)`)
    const checkForUpdates = setupAutoUpdater({
      isPackaged: app.isPackaged,
      updateFeedPresent: app.isPackaged && existsSync(join(process.resourcesPath, 'app-update.yml')),
      log: (line) => { log.write(`[updater] ${line}`) },
      prepareForInstall: async () => {
        // The NSIS installer spawns before the app quits; a live Harness
        // child keeps files under the install directory locked and the
        // installer reports the app as impossible to close. Stop it first.
        quitting = true
        await harness.stop()
      },
    })
    installMenu(
      {
        restartHarness: () => void restartHarness(),
        viewLogs: () => void shell.openPath(paths.logFile),
        checkForUpdates,
      },
      paths.userData,
    )
    ipcMain.on('dsh-desktop:shell-action', (_event, action: ShellAction) => { handleShellAction(action) })
    await startHarness()
    if (app.isPackaged) checkForUpdates()
  })

  app.on('window-all-closed', () => { app.quit() })

  app.on('before-quit', (event) => {
    if (quitting) return
    event.preventDefault()
    quitting = true
    void harness.stop().then(() => log.close()).then(() => { app.quit() })
  })
}
