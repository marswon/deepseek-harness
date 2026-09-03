import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * updater.ts wires electron-updater dialogs and owns the install handoff;
 * electron, child_process, and electron-updater are mocked so the event
 * handlers can be driven directly. process.platform and process.resourcesPath
 * are stubbed per test because the update flow differs across darwin
 * (download the dmg, open it) and win32 (spawn the pending NSIS installer,
 * then quit).
 */

const mocks = vi.hoisted(() => ({
  showMessageBox: vi.fn(),
  openExternal: vi.fn(),
  openPath: vi.fn(async (_path: string) => ''),
  appQuit: vi.fn(),
  appGetPath: vi.fn(),
  netFetch: vi.fn(),
  spawn: vi.fn(),
  checkForUpdates: vi.fn(async () => ({})),
  quitAndInstall: vi.fn(),
  handlers: new Map<string, (info?: unknown) => void>(),
}))
const { showMessageBox, openExternal, openPath, appQuit, appGetPath, netFetch, spawn, checkForUpdates, quitAndInstall, handlers } = mocks

/** A spawned child that reports a successful spawn and an immediate exit. */
function fakeChild(): unknown {
  const child = new EventEmitter() as EventEmitter & { unref: () => void }
  child.unref = () => {}
  queueMicrotask(() => {
    child.emit('spawn')
    child.emit('exit', 0)
  })
  return child
}

vi.mock('electron', () => ({
  app: {
    getPath: (name: string): unknown => mocks.appGetPath(name) as unknown,
    quit: (): unknown => mocks.appQuit() as unknown,
  },
  dialog: { showMessageBox: (options: unknown): unknown => mocks.showMessageBox(options) as unknown },
  net: { fetch: (...args: unknown[]): unknown => mocks.netFetch(...args) as unknown },
  shell: {
    openExternal: (url: string): unknown => mocks.openExternal(url) as unknown,
    openPath: (path: string): unknown => mocks.openPath(path),
  },
}))
vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]): unknown => mocks.spawn(...args) as unknown,
}))
vi.mock('electron-updater', () => ({
  default: {
    autoUpdater: {
      autoDownload: true,
      on: (event: string, cb: (info?: unknown) => void) => { mocks.handlers.set(event, cb) },
      checkForUpdates: mocks.checkForUpdates,
      quitAndInstall: mocks.quitAndInstall,
    },
  },
}))

import { setupAutoUpdater } from '../src/main/updater.ts'

const realPlatform = process.platform
const realResourcesPath = process.resourcesPath

function stubPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}

function stubResourcesPath(resourcesPath: string): void {
  Object.defineProperty(process, 'resourcesPath', { value: resourcesPath, configurable: true })
}

/** Flush the dialog .then() chain plus any prepare/quit microtasks. */
async function settle(): Promise<void> {
  await new Promise(resolve => setImmediate(resolve))
  await new Promise(resolve => setImmediate(resolve))
}

describe('setupAutoUpdater', () => {
  const scratch: string[] = []

  beforeEach(() => {
    for (const mock of [showMessageBox, openExternal, openPath, appQuit, appGetPath, netFetch, checkForUpdates, quitAndInstall]) {
      mock.mockReset()
    }
    openPath.mockResolvedValue('')
    spawn.mockReset()
    spawn.mockImplementation(() => fakeChild())
    handlers.clear()
  })
  afterEach(async () => {
    Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true })
    Object.defineProperty(process, 'resourcesPath', { value: realResourcesPath, configurable: true })
    delete process.env['LOCALAPPDATA']
    await Promise.all(scratch.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
  })

  async function scratchDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-updater-spec-'))
    scratch.push(dir)
    return dir
  }

  it('reports that development builds never check', () => {
    const check = setupAutoUpdater({ isPackaged: false, updateFeedPresent: false, log: () => {} })
    check()
    expect(showMessageBox).toHaveBeenCalledWith({ message: 'Updates are only available in packaged builds.' })
  })

  it('reports when the build carries no update feed', () => {
    const check = setupAutoUpdater({ isPackaged: true, updateFeedPresent: false, log: () => {} })
    check()
    expect(showMessageBox).toHaveBeenCalledWith({ message: 'This build has no update feed configured.' })
  })

  it('on win32 Restart stops the child, sweeps stale installers, schedules the pending installer after exit, then quits', async () => {
    stubPlatform('win32')
    const localAppData = await scratchDir()
    process.env['LOCALAPPDATA'] = localAppData
    const resources = await scratchDir()
    await writeFile(join(resources, 'app-update.yml'), "updaterCacheDirName: '@deepseek-aidsh-desktop-updater'\n")
    stubResourcesPath(resources)
    const pending = join(localAppData, '@deepseek-aidsh-desktop-updater', 'pending')
    await mkdir(pending, { recursive: true })
    await writeFile(join(pending, 'DeepSeek-Harness-Setup-0.2.0.exe'), 'MZ')

    const order: string[] = []
    setupAutoUpdater({
      isPackaged: true,
      updateFeedPresent: true,
      log: () => {},
      prepareForInstall: async () => { order.push('prepare') },
    })
    appQuit.mockImplementation(() => { order.push('quit') })
    showMessageBox.mockResolvedValue({ response: 0 })
    handlers.get('update-downloaded')?.({ version: '0.2.0', path: 'DeepSeek-Harness-Setup-0.2.0.exe', files: [] })
    await vi.waitFor(() => { expect(order).toEqual(['prepare', 'quit']) })
    // The detached waiter starts the installer only after the Electron PID exits.
    const waiter = spawn.mock.calls.find(call => String(call[0]) === 'powershell.exe'
      && String((call[1] as string[]).at(-1)).includes('Start-Process'))
    expect(String((waiter?.[1] as string[] | undefined)?.at(-1))).toContain('DeepSeek-Harness-Setup-0.2.0.exe')
    expect(waiter?.[2]).toMatchObject({ detached: true, windowsHide: true })
    // The stale-installer sweep ran against the pending directory first.
    const sweep = spawn.mock.calls.find(call => String(call[0]) === 'powershell.exe'
      && String((call[1] as string[]).at(-1)).includes('Get-CimInstance'))
    expect(String((sweep?.[1] as string[] | undefined)?.at(-1))).toContain('@deepseek-aidsh-desktop-updater')
    expect(quitAndInstall).not.toHaveBeenCalled()
  })

  it('on win32 a missing pending installer falls back to quitAndInstall after prepare', async () => {
    stubPlatform('win32')
    const order: string[] = []
    stubResourcesPath(await scratchDir()) // no app-update.yml inside
    setupAutoUpdater({
      isPackaged: true,
      updateFeedPresent: true,
      log: () => {},
      prepareForInstall: async () => { order.push('prepare') },
    })
    quitAndInstall.mockImplementation(() => { order.push('quitAndInstall') })
    showMessageBox.mockResolvedValue({ response: 0 })
    handlers.get('update-downloaded')?.({ version: '0.2.0', path: 'DeepSeek-Harness-Setup-0.2.0.exe', files: [] })
    await vi.waitFor(() => { expect(order).toEqual(['prepare', 'quitAndInstall']) })
    expect(appQuit).not.toHaveBeenCalled()
  })

  it('on win32 a failing prepare step cannot block the install', async () => {
    stubPlatform('win32')
    stubResourcesPath(await scratchDir())
    setupAutoUpdater({
      isPackaged: true,
      updateFeedPresent: true,
      log: () => {},
      prepareForInstall: async () => { throw new Error('stop failed') },
    })
    showMessageBox.mockResolvedValue({ response: 0 })
    handlers.get('update-downloaded')?.({ version: '0.2.0', path: 'x.exe', files: [] })
    await vi.waitFor(() => { expect(quitAndInstall).toHaveBeenCalledOnce() })
  })

  it('on win32 Later leaves the app running', async () => {
    stubPlatform('win32')
    setupAutoUpdater({ isPackaged: true, updateFeedPresent: true, log: () => {} })
    showMessageBox.mockResolvedValue({ response: 1 })
    handlers.get('update-downloaded')?.({ version: '0.2.0', path: 'x.exe', files: [] })
    await settle()
    expect(quitAndInstall).not.toHaveBeenCalled()
    expect(appQuit).not.toHaveBeenCalled()
  })

  it('on linux Restart stops the child then hands the install to electron-updater', async () => {
    stubPlatform('linux')
    // No package-type marker: an AppImage build, electron-updater's default.
    stubResourcesPath(await scratchDir())
    const order: string[] = []
    const lines: string[] = []
    setupAutoUpdater({
      isPackaged: true,
      updateFeedPresent: true,
      log: (line) => { lines.push(line) },
      prepareForInstall: async () => { order.push('prepare') },
    })
    quitAndInstall.mockImplementation(() => { order.push('quitAndInstall') })
    showMessageBox.mockResolvedValue({ response: 0 })
    handlers.get('update-downloaded')?.({ version: '0.2.0', files: [] })
    await vi.waitFor(() => { expect(order).toEqual(['prepare', 'quitAndInstall']) })
    // The Linux branch ran, not the Windows pending-installer handoff, which
    // would reach for %LOCALAPPDATA% and powershell.exe instead.
    expect(lines).toContain('linux package type: appimage')
    expect(lines).toContain('installing appimage update: 0.2.0')
    expect(spawn).not.toHaveBeenCalled()
    expect(appQuit).not.toHaveBeenCalled()
  })

  it('on linux an AppImage restart prompt does not mention a password', async () => {
    stubPlatform('linux')
    stubResourcesPath(await scratchDir())
    setupAutoUpdater({ isPackaged: true, updateFeedPresent: true, log: () => {} })
    showMessageBox.mockResolvedValue({ response: 1 })
    handlers.get('update-downloaded')?.({ version: '0.2.0', files: [] })
    await settle()
    expect(showMessageBox.mock.calls[0]?.[0]).toMatchObject({
      detail: 'Version 0.2.0 has been downloaded. Restart to apply it.',
    })
  })

  it('on linux a deb install warns that the system will ask for a password', async () => {
    stubPlatform('linux')
    const resources = await scratchDir()
    await writeFile(join(resources, 'package-type'), 'deb\n')
    stubResourcesPath(resources)
    setupAutoUpdater({ isPackaged: true, updateFeedPresent: true, log: () => {} })
    showMessageBox.mockResolvedValue({ response: 1 })
    handlers.get('update-downloaded')?.({ version: '0.2.0', files: [] })
    await settle()
    expect(String((showMessageBox.mock.calls[0]?.[0] as { detail?: string } | undefined)?.detail)).toContain('ask for your password')
  })

  it('on linux Later leaves the app running', async () => {
    stubPlatform('linux')
    stubResourcesPath(await scratchDir())
    setupAutoUpdater({ isPackaged: true, updateFeedPresent: true, log: () => {} })
    showMessageBox.mockResolvedValue({ response: 1 })
    handlers.get('update-downloaded')?.({ version: '0.2.0', files: [] })
    await settle()
    expect(quitAndInstall).not.toHaveBeenCalled()
    expect(appQuit).not.toHaveBeenCalled()
  })

  it('on linux a refused check reports that updates are unavailable', async () => {
    stubPlatform('linux')
    stubResourcesPath(await scratchDir())
    // isUpdaterActive() false (an AppImage without its runtime) resolves null
    // without emitting any event, so the menu would otherwise look dead.
    checkForUpdates.mockResolvedValue(null as never)
    const check = setupAutoUpdater({ isPackaged: true, updateFeedPresent: true, log: () => {} })
    check()
    await vi.waitFor(() => { expect(showMessageBox).toHaveBeenCalledOnce() })
    expect(showMessageBox.mock.calls[0]?.[0]).toMatchObject({ message: 'Updates are not available for this build' })
    expect(String((showMessageBox.mock.calls[0]?.[0] as { detail?: string } | undefined)?.detail)).toContain('AppImage')
  })

  it('on darwin Download fetches the dmg into userData and opens it', async () => {
    stubPlatform('darwin')
    const userData = await scratchDir()
    appGetPath.mockReturnValue(userData)
    netFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]))
          controller.close()
        },
      }),
    })
    setupAutoUpdater({ isPackaged: true, updateFeedPresent: true, log: () => {} })
    showMessageBox.mockResolvedValue({ response: 0 })
    handlers.get('update-available')?.({ version: '0.2.0' })
    const expected = join(userData, 'updates', '0.2.0', `DeepSeek-Harness-0.2.0-${process.arch}.dmg`)
    await vi.waitFor(() => { expect(openPath).toHaveBeenCalledWith(expected) })
    expect(await readFile(expected)).toEqual(Buffer.from([1, 2, 3]))
    expect(netFetch.mock.calls[0]?.[0]).toBe(
      'https://github.com/marswon/deepseek-harness/releases/download/v0.2.0/' + `DeepSeek-Harness-0.2.0-${process.arch}.dmg`,
    )
    expect(quitAndInstall).not.toHaveBeenCalled()
  })

  it('on darwin a failed download offers the release page instead', async () => {
    stubPlatform('darwin')
    appGetPath.mockReturnValue(await scratchDir())
    netFetch.mockRejectedValue(new Error('offline'))
    setupAutoUpdater({ isPackaged: true, updateFeedPresent: true, log: () => {} })
    showMessageBox.mockResolvedValue({ response: 0 })
    handlers.get('update-available')?.({ version: '0.2.0' })
    await vi.waitFor(() => {
      expect(openExternal).toHaveBeenCalledWith(
        'https://github.com/marswon/deepseek-harness/releases/tag/v0.2.0',
      )
    })
    expect(quitAndInstall).not.toHaveBeenCalled()
  })

  it('on darwin Later downloads nothing', async () => {
    stubPlatform('darwin')
    setupAutoUpdater({ isPackaged: true, updateFeedPresent: true, log: () => {} })
    showMessageBox.mockResolvedValue({ response: 1 })
    handlers.get('update-available')?.({ version: '0.2.0' })
    await settle()
    expect(netFetch).not.toHaveBeenCalled()
  })

  it('a failed check is logged, never thrown into a dialog', async () => {
    stubPlatform('win32')
    const lines: string[] = []
    const check = setupAutoUpdater({ isPackaged: true, updateFeedPresent: true, log: (line) => { lines.push(line) } })
    checkForUpdates.mockRejectedValueOnce(new Error('offline'))
    check()
    await vi.waitFor(() => { expect(lines.some(line => line.includes('offline'))).toBe(true) })
  })
})
