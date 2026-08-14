import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { HarnessProcess } from '../src/main/harness-process.ts'
import { ensureDesktopPaths, resolveDesktopPaths } from '../src/main/paths.ts'
import { buildHarnessLaunch } from '../src/main/runtime.ts'

// Source-plane gate: this suite consumes the built CLI (apps/cli/lib/bin.js)
// and the built web dist, so it self-skips on a clean tree — run
// `pnpm run build` at the repository root to enable it.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const builtBin = join(repoRoot, 'apps/cli/lib/bin.js')
const builtDist = join(repoRoot, 'apps/web/dist/index.html')
const bootable = existsSync(builtBin) && existsSync(builtDist)

describe('dsh web boot smoke', () => {
  let userData = ''
  afterEach(async () => {
    if (userData !== '') await rm(userData, { recursive: true, force: true })
  })

  it.skipIf(!bootable)('boots the web profile on a random loopback port and serves the UI', async () => {
    userData = await mkdtemp(join(tmpdir(), 'dsh-desktop-smoke-'))
    const paths = resolveDesktopPaths(userData)
    await ensureDesktopPaths(paths)
    const harness = new HarnessProcess({ readyTimeoutMs: 60_000 })
    try {
      const url = await harness.start(buildHarnessLaunch(
        { kind: 'development', repoRoot, nodeCommand: process.execPath },
        paths,
        { ...process.env },
      ))
      expect(new URL(url).hostname).toBe('127.0.0.1')
      const response = await fetch(url)
      expect(response.status).toBe(200)
      expect(await response.text()).toContain('<html')
    } finally {
      await harness.stop()
    }
  }, 90_000)
})
