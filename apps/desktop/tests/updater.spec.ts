import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * updater.ts wires electron-updater dialogs; both electron modules are mocked
 * so the event handlers can be driven directly. process.platform is stubbed
 * per test because the update flow differs across darwin (manual download)
 * and win32 (auto download + quitAndInstall).
 */

const mocks = vi.hoisted(() => ({
  showMessageBox: vi.fn(),
  openExternal: vi.fn(),
  checkForUpdates: vi.fn(async () => ({})),
  quitAndInstall: vi.fn(),
  handlers: new Map<string, (info?: unknown) => void>(),
}))
const { showMessageBox, openExternal, checkForUpdates, quitAndInstall, handlers } = mocks

vi.mock('electron', () => ({
  dialog: { showMessageBox: (options: unknown): unknown => mocks.showMessageBox(options) as unknown },
  shell: { openExternal: (url: string): unknown => mocks.openExternal(url) as unknown },
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

function stubPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}

/** Flush the dialog .then() chain plus any prepare/quit microtasks. */
async function settle(): Promise<void> {
  await vi.waitFor(() => { /* resolved by assertions below */ }, { timeout: 50 }).catch(() => {})
  await new Promise(resolve => setImmediate(resolve))
  await new Promise(resolve => setImmediate(resolve))
}

describe('setupAutoUpdater', () => {
  beforeEach(() => {
    showMessageBox.mockReset()
    openExternal.mockReset()
    checkForUpdates.mockClear()
    quitAndInstall.mockClear()
    handlers.clear()
  })
  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true })
  })

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

  it('on win32 the Restart button stops the Harness child before quitAndInstall', async () => {
    stubPlatform('win32')
    const order: string[] = []
    setupAutoUpdater({
      isPackaged: true,
      updateFeedPresent: true,
      log: () => {},
      prepareForInstall: async () => { order.push('prepare') },
    })
    quitAndInstall.mockImplementation(() => { order.push('quitAndInstall') })
    showMessageBox.mockResolvedValue({ response: 0 })
    handlers.get('update-downloaded')?.()
    await vi.waitFor(() => { expect(order).toEqual(['prepare', 'quitAndInstall']) })
  })

  it('on win32 a failing prepare step cannot block quitAndInstall', async () => {
    stubPlatform('win32')
    setupAutoUpdater({
      isPackaged: true,
      updateFeedPresent: true,
      log: () => {},
      prepareForInstall: async () => { throw new Error('stop failed') },
    })
    showMessageBox.mockResolvedValue({ response: 0 })
    handlers.get('update-downloaded')?.()
    await vi.waitFor(() => { expect(quitAndInstall).toHaveBeenCalledOnce() })
  })

  it('on win32 Later leaves the app running', async () => {
    stubPlatform('win32')
    setupAutoUpdater({ isPackaged: true, updateFeedPresent: true, log: () => {} })
    showMessageBox.mockResolvedValue({ response: 1 })
    handlers.get('update-downloaded')?.()
    await settle()
    expect(quitAndInstall).not.toHaveBeenCalled()
  })

  it('on darwin an available update links to its release page instead of downloading', async () => {
    stubPlatform('darwin')
    setupAutoUpdater({ isPackaged: true, updateFeedPresent: true, log: () => {} })
    showMessageBox.mockResolvedValue({ response: 0 })
    handlers.get('update-available')?.({ version: '0.1.0-rc.10' })
    await vi.waitFor(() => {
      expect(openExternal).toHaveBeenCalledWith(
        'https://github.com/marswon/deepseek-harness/releases/tag/v0.1.0-rc.10',
      )
    })
    expect(quitAndInstall).not.toHaveBeenCalled()
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
