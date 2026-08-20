import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ spawnSync: vi.fn() }))
vi.mock('node:child_process', () => ({
  spawnSync: (...args: unknown[]): unknown => mocks.spawnSync(...args),
}))

import { runPlugin } from '../src/plugin.ts'

const originalHome = process.env['DSH_HOME']
const originalBundledRuntime = process.env['DSH_BUNDLED_NODE_RUNTIME']

afterEach(async () => {
  if (originalHome === undefined) delete process.env['DSH_HOME']
  else process.env['DSH_HOME'] = originalHome
  if (originalBundledRuntime === undefined) delete process.env['DSH_BUNDLED_NODE_RUNTIME']
  else process.env['DSH_BUNDLED_NODE_RUNTIME'] = originalBundledRuntime
  mocks.spawnSync.mockReset()
})

describe('runPlugin', () => {
  it('uses the packaged Corepack before forwarding pnpm', async () => {
    const home = await mkdtemp(`${tmpdir()}/dsh-plugin-corepack-`)
    try {
      process.env['DSH_HOME'] = home
      process.env['DSH_BUNDLED_NODE_RUNTIME'] = '1'
      mocks.spawnSync.mockReturnValue({ status: 0 })

      expect(runPlugin('isolated', ['install'])).toBe(0)

      const command = process.platform === 'win32' ? 'corepack.cmd' : 'corepack'
      expect(mocks.spawnSync).toHaveBeenNthCalledWith(1, command, ['enable'], {
        stdio: 'inherit',
        shell: process.platform === 'win32',
      })
      expect(mocks.spawnSync).toHaveBeenNthCalledWith(2, command, ['pnpm@11.7.0', 'install'], {
        cwd: join(home, 'profiles', 'isolated'),
        stdio: 'inherit',
        shell: process.platform === 'win32',
      })
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })
})
