import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * installMenu builds the platform menu from a template; electron's Menu/app/
 * shell/dialog are captured through mocks so the template can be inspected
 * and menu-item clicks driven directly.
 */

const mocks = vi.hoisted(() => ({
  setApplicationMenu: vi.fn(),
  openPath: vi.fn(async () => ''),
  showMessageBox: vi.fn(async () => ({ response: 0 })),
  version: '0.0.0-test',
}))

vi.mock('electron', () => ({
  app: { name: 'DeepSeek Harness', getVersion: () => mocks.version },
  dialog: { showMessageBox: (options: unknown) => mocks.showMessageBox(options) },
  shell: { openPath: (path: string) => mocks.openPath(path) },
  Menu: {
    buildFromTemplate: (template: unknown) => template,
    setApplicationMenu: (menu: unknown): unknown => mocks.setApplicationMenu(menu) as unknown,
  },
}))

import { installMenu } from '../src/main/menu.ts'

interface Item {
  label?: string
  role?: string
  type?: string
  submenu?: Item[]
  click?: () => void
}

const realPlatform = process.platform

function stubPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}

function installedTemplate(): Item[] {
  installMenu({ restartHarness: vi.fn(), viewLogs: vi.fn(), checkForUpdates: vi.fn() }, '/data')
  return mocks.setApplicationMenu.mock.calls[0]![0] as Item[]
}

function flatten(items: readonly Item[]): Item[] {
  return items.flatMap(item => [item, ...flatten(item.submenu ?? [])])
}

describe('installMenu', () => {
  beforeEach(() => {
    mocks.setApplicationMenu.mockClear()
    mocks.openPath.mockClear()
    mocks.showMessageBox.mockClear()
  })
  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true })
  })

  it('on win32 the Harness menu carries Check for Updates and an About entry with the version', () => {
    stubPlatform('win32')
    const items = flatten(installedTemplate())
    expect(items.some(item => item.label === 'Check for Updates…')).toBe(true)
    const about = items.find(item => item.label === 'About DeepSeek Harness')
    expect(about).toBeDefined()
    about!.click!()
    expect(mocks.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({
      detail: 'Version 0.0.0-test',
    }))
  })

  it('on darwin the app menu uses the About role and the Harness menu has no custom About', () => {
    stubPlatform('darwin')
    const items = flatten(installedTemplate())
    expect(items.some(item => item.role === 'about')).toBe(true)
    expect(items.some(item => item.label === 'About DeepSeek Harness')).toBe(false)
  })

  it('every platform keeps the Edit role menu (paste depends on it)', () => {
    stubPlatform('win32')
    const items = flatten(installedTemplate())
    for (const role of ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']) {
      expect(items.some(item => item.role === role)).toBe(true)
    }
  })
})
