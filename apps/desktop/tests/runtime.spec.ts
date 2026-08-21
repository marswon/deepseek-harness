import { spawnSync } from 'node:child_process'
import { lstat, mkdtemp, mkdir, readFile, readdir, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildHarnessLaunch, bundledNodePath, harnessBinPath, parseReadyUrl, resolveHarnessRuntime,
  stagePackagedRuntime,
} from '../src/main/runtime.ts'
import { resolveDesktopPaths } from '../src/main/paths.ts'

vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  spawnSync: vi.fn(),
}))

/** The platform-arch-keyed directory name staging targets. */
const stagedName = (version: string): string => `${version}-${process.platform}-${process.arch}`

const paths = resolveDesktopPaths('/userdata')

describe('parseReadyUrl', () => {
  it('parses the ready line with an OS-assigned port', () => {
    expect(parseReadyUrl('dsh web: http://127.0.0.1:51234')).toBe('http://127.0.0.1:51234')
    expect(parseReadyUrl('  dsh web: http://127.0.0.1:3080  ')).toBe('http://127.0.0.1:3080')
  })

  it('rejects unrelated output', () => {
    expect(parseReadyUrl('')).toBeNull()
    expect(parseReadyUrl('dsh web starting')).toBeNull()
    expect(parseReadyUrl('https://example.com')).toBeNull()
    expect(parseReadyUrl('dsh web: not-a-url')).toBeNull()
  })
})

describe('harnessBinPath', () => {
  it('resolves the repository CLI bin in development', () => {
    expect(harnessBinPath({ kind: 'development', repoRoot: '/repo', nodeCommand: 'node' }))
      .toBe('/repo/apps/cli/lib/bin.js')
  })

  it('resolves the staged runtime bin in packaged builds', () => {
    expect(harnessBinPath({ kind: 'packaged', runtimeDir: '/staged/dsh-runtime' }))
      .toBe('/staged/dsh-runtime/lib/bin.js')
  })
})

describe('buildHarnessLaunch', () => {
  it('runs system node against the repo bin in development', () => {
    const launch = buildHarnessLaunch(
      { kind: 'development', repoRoot: '/repo', nodeCommand: '/usr/bin/node' },
      paths,
      { PATH: '/usr/bin' },
    )
    expect(launch.command).toBe('/usr/bin/node')
    expect(launch.args).toEqual([
      '--expose-internals', '/repo/apps/cli/lib/bin.js', 'web', '--patch', paths.desktopPatchFile,
      '--host', '127.0.0.1', '--port', '0',
    ])
    expect(launch.cwd).toBe(paths.launchRoot)
    expect(launch.env['DSH_HOME']).toBe(paths.dshHome)
    expect(launch.env['PATH']).toBe('/usr/bin')
    expect(launch.env['ELECTRON_RUN_AS_NODE']).toBeUndefined()
  })

  it('runs the bundled Node runtime in packaged builds', () => {
    const launch = buildHarnessLaunch(
      { kind: 'packaged', runtimeDir: '/staged/dsh-runtime' },
      paths,
      {},
    )
    expect(launch.command).toBe(bundledNodePath('/staged/dsh-runtime'))
    expect(launch.command).toMatch(/node-runtime(?:[\\/]bin)?[\\/]node(\.exe)?$/)
    expect(launch.args).toEqual([
      '--expose-internals', '/staged/dsh-runtime/lib/bin.js', 'web', '--patch', paths.desktopPatchFile,
      '--host', '127.0.0.1', '--port', '0',
    ])
    expect(launch.env['ELECTRON_RUN_AS_NODE']).toBeUndefined()
    expect(launch.env['DSH_HOME']).toBe(paths.dshHome)
    expect(launch.env['DSH_BUNDLED_NODE_RUNTIME']).toBe('1')
  })

  it('puts the bundled Node bin directory on PATH in packaged builds', () => {
    const launch = buildHarnessLaunch(
      { kind: 'packaged', runtimeDir: '/staged/dsh-runtime' },
      paths,
      { PATH: '/usr/bin' },
    )
    // Plugins spawn Corepack/npm/npx by name from the complete Node distribution.
    expect(launch.env['PATH']).toBe(`${dirname(bundledNodePath('/staged/dsh-runtime'))}${delimiter}/usr/bin`)
  })

  it('never mutates the caller environment', () => {
    const base = { PATH: '/usr/bin' }
    buildHarnessLaunch({ kind: 'development', repoRoot: '/repo', nodeCommand: 'node' }, paths, base)
    expect(base).toEqual({ PATH: '/usr/bin' })
  })
})

/** Build a fake bundled runtime: resourcesPath/dsh-runtime with one payload file. */
async function makeBundledRuntime(root: string): Promise<string> {
  const resources = join(root, 'resources')
  await mkdir(join(resources, 'dsh-runtime/lib'), { recursive: true })
  const nodePath = process.platform === 'win32'
    ? join(resources, 'dsh-runtime/node-runtime/node.exe')
    : join(resources, 'dsh-runtime/node-runtime/bin/node')
  await mkdir(dirname(nodePath), { recursive: true })
  await writeFile(join(resources, 'dsh-runtime/lib/bin.js'), '// bin\n')
  await writeFile(nodePath, 'binary\n')
  return resources
}

describe('stagePackagedRuntime', () => {
  const sandboxes: string[] = []
  beforeEach(() => {
    // Default probe: the staged Node answers --version.
    vi.mocked(spawnSync).mockReset()
    vi.mocked(spawnSync).mockReturnValue({ status: 0, stdout: 'v22.21.1\n' } as never)
  })
  afterEach(async () => {
    await Promise.all(sandboxes.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
  })

  async function sandbox(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-staging-test-'))
    sandboxes.push(dir)
    return dir
  }

  it('copies the bundled runtime into a versioned directory and marks it complete', async () => {
    const root = await sandbox()
    const resources = await makeBundledRuntime(root)
    const runtimeRoot = join(root, 'runtimes')
    const staged = await stagePackagedRuntime(resources, runtimeRoot, '1.0.0')
    expect(staged).toBe(join(runtimeRoot, stagedName('1.0.0')))
    expect(await readFile(join(staged, 'lib/bin.js'), 'utf8')).toBe('// bin\n')
    expect(await readFile(join(staged, '.dsh-runtime-complete'), 'utf8')).toBe('1.0.0')
  })

  it('re-copies once when the Node probe fails, then marks completion', async () => {
    const root = await sandbox()
    const resources = await makeBundledRuntime(root)
    const runtimeRoot = join(root, 'runtimes')
    const probe = vi.mocked(spawnSync)
    probe.mockReturnValueOnce({ status: 2, stdout: '' } as never)
    const staged = await stagePackagedRuntime(resources, runtimeRoot, '1.0.0')
    expect(probe).toHaveBeenCalledTimes(2)
    expect(await readFile(join(staged, '.dsh-runtime-complete'), 'utf8')).toBe('1.0.0')
  })

  it('refuses a runtime whose Node probe keeps failing and leaves nothing behind', async () => {
    const root = await sandbox()
    const resources = await makeBundledRuntime(root)
    const runtimeRoot = join(root, 'runtimes')
    vi.mocked(spawnSync).mockReturnValue({ status: 2, stdout: '' } as never)
    await expect(stagePackagedRuntime(resources, runtimeRoot, '1.0.0'))
      .rejects.toThrow(/node --version.*probe/)
    expect(await readdir(runtimeRoot)).toEqual([])
  })

  it.skipIf(process.platform === 'win32')('preserves bundled Node relative symlinks', async () => {
    const root = await sandbox()
    const resources = await makeBundledRuntime(root)
    const runtimeRoot = join(root, 'runtimes')
    const corepackTarget = join(resources, 'dsh-runtime/node-runtime/lib/corepack.js')
    const corepackLink = join(resources, 'dsh-runtime/node-runtime/bin/corepack')
    await mkdir(dirname(corepackTarget), { recursive: true })
    await writeFile(corepackTarget, '// corepack\n')
    await symlink('../lib/corepack.js', corepackLink)

    const staged = await stagePackagedRuntime(resources, runtimeRoot, '1.0.0')
    const stagedLink = join(staged, 'node-runtime/bin/corepack')
    expect((await lstat(stagedLink)).isSymbolicLink()).toBe(true)
    expect(await readlink(stagedLink)).toBe('../lib/corepack.js')
  })

  it('reuses a completed copy without re-copying', async () => {
    const root = await sandbox()
    const resources = await makeBundledRuntime(root)
    const runtimeRoot = join(root, 'runtimes')
    const staged = await stagePackagedRuntime(resources, runtimeRoot, '1.0.0')
    // A sentinel survives the second stage only when the copy is reused.
    await writeFile(join(staged, 'sentinel'), 'keep')
    await rm(resources, { recursive: true }) // prove the source is not read again
    expect(await stagePackagedRuntime(resources, runtimeRoot, '1.0.0')).toBe(staged)
    expect(await readFile(join(staged, 'sentinel'), 'utf8')).toBe('keep')
  })

  it('rebuilds a copy whose marker is missing (crash mid-copy) and drops stale staging dirs', async () => {
    const root = await sandbox()
    const resources = await makeBundledRuntime(root)
    const runtimeRoot = join(root, 'runtimes')
    // Leftover from a killed run: a partial target and a stale staging dir.
    await mkdir(join(runtimeRoot, `${stagedName('1.0.0')}/lib`), { recursive: true })
    await mkdir(join(runtimeRoot, '.staging-999'), { recursive: true })
    const staged = await stagePackagedRuntime(resources, runtimeRoot, '1.0.0')
    expect(await readFile(join(staged, 'lib/bin.js'), 'utf8')).toBe('// bin\n')
    expect(await readdir(runtimeRoot)).toEqual([stagedName('1.0.0')])
  })

  it('re-stages on a version change and removes the old version', async () => {
    const root = await sandbox()
    const resources = await makeBundledRuntime(root)
    const runtimeRoot = join(root, 'runtimes')
    await stagePackagedRuntime(resources, runtimeRoot, '1.0.0')
    await stagePackagedRuntime(resources, runtimeRoot, '1.1.0')
    expect((await readdir(runtimeRoot)).sort()).toEqual([stagedName('1.1.0')])
  })

  it('resolveHarnessRuntime passes development through and stages packaged builds', async () => {
    const dev = { kind: 'development', repoRoot: '/repo', nodeCommand: 'node' } as const
    expect(await resolveHarnessRuntime(dev, paths, '1.0.0')).toBe(dev)

    const root = await sandbox()
    const resources = await makeBundledRuntime(root)
    const desktopPaths = resolveDesktopPaths(join(root, 'userdata'))
    const resolved = await resolveHarnessRuntime({ kind: 'packaged', resourcesPath: resources }, desktopPaths, '2.0.0')
    expect(resolved).toEqual({ kind: 'packaged', runtimeDir: join(desktopPaths.runtimeRoot, stagedName('2.0.0')) })
  })
})
