import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildHarnessLaunch, bundledNodePath, harnessBinPath, parseReadyUrl, resolveHarnessRuntime,
  stagePackagedRuntime,
} from '../src/main/runtime.ts'
import { resolveDesktopPaths } from '../src/main/paths.ts'

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
    expect(launch.args).toEqual(['--expose-internals', '/repo/apps/cli/lib/bin.js', 'web', '--host', '127.0.0.1', '--port', '0'])
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
    expect(launch.command).toMatch(/node-runtime[\\/]node(\.exe)?$/)
    expect(launch.args).toEqual(['--expose-internals', '/staged/dsh-runtime/lib/bin.js', 'web', '--host', '127.0.0.1', '--port', '0'])
    expect(launch.env['ELECTRON_RUN_AS_NODE']).toBeUndefined()
    expect(launch.env['DSH_HOME']).toBe(paths.dshHome)
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
  await mkdir(join(resources, 'dsh-runtime/node-runtime'), { recursive: true })
  await writeFile(join(resources, 'dsh-runtime/lib/bin.js'), '// bin\n')
  await writeFile(join(resources, 'dsh-runtime/node-runtime/node'), 'binary\n')
  return resources
}

describe('stagePackagedRuntime', () => {
  const sandboxes: string[] = []
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
    expect(staged).toBe(join(runtimeRoot, '1.0.0'))
    expect(await readFile(join(staged, 'lib/bin.js'), 'utf8')).toBe('// bin\n')
    expect(await readFile(join(staged, '.dsh-runtime-complete'), 'utf8')).toBe('1.0.0')
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
    await mkdir(join(runtimeRoot, '1.0.0/lib'), { recursive: true })
    await mkdir(join(runtimeRoot, '.staging-999'), { recursive: true })
    const staged = await stagePackagedRuntime(resources, runtimeRoot, '1.0.0')
    expect(await readFile(join(staged, 'lib/bin.js'), 'utf8')).toBe('// bin\n')
    expect(await readdir(runtimeRoot)).toEqual(['1.0.0'])
  })

  it('re-stages on a version change and removes the old version', async () => {
    const root = await sandbox()
    const resources = await makeBundledRuntime(root)
    const runtimeRoot = join(root, 'runtimes')
    await stagePackagedRuntime(resources, runtimeRoot, '1.0.0')
    await stagePackagedRuntime(resources, runtimeRoot, '1.1.0')
    expect((await readdir(runtimeRoot)).sort()).toEqual(['1.1.0'])
  })

  it('resolveHarnessRuntime passes development through and stages packaged builds', async () => {
    const dev = { kind: 'development', repoRoot: '/repo', nodeCommand: 'node' } as const
    expect(await resolveHarnessRuntime(dev, paths, '1.0.0')).toBe(dev)

    const root = await sandbox()
    const resources = await makeBundledRuntime(root)
    const desktopPaths = resolveDesktopPaths(join(root, 'userdata'))
    const resolved = await resolveHarnessRuntime({ kind: 'packaged', resourcesPath: resources }, desktopPaths, '2.0.0')
    expect(resolved).toEqual({ kind: 'packaged', runtimeDir: join(desktopPaths.runtimeRoot, '2.0.0') })
  })
})
