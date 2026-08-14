import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ensureDesktopPaths, resolveDesktopPaths } from '../src/main/paths.ts'

describe('resolveDesktopPaths', () => {
  it('lays every desktop-owned path under userData', () => {
    const paths = resolveDesktopPaths('/userdata')
    expect(paths.dshHome).toBe('/userdata/harness')
    expect(paths.launchRoot).toBe('/userdata/launch-root')
    expect(paths.logFile).toBe('/userdata/logs/harness.log')
  })
})

describe('ensureDesktopPaths', () => {
  let userData = ''

  beforeEach(async () => {
    userData = await mkdtemp(join(tmpdir(), 'dsh-desktop-'))
  })
  afterEach(async () => {
    await rm(userData, { recursive: true, force: true })
  })

  it('creates the layout and is idempotent', async () => {
    const paths = resolveDesktopPaths(userData)
    await ensureDesktopPaths(paths)
    await ensureDesktopPaths(paths)
    for (const dir of [paths.dshHome, paths.launchRoot, paths.logDir]) {
      expect((await stat(dir)).isDirectory()).toBe(true)
    }
  })
})
