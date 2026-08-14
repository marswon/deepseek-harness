import { describe, expect, it } from 'vitest'
import { buildHarnessLaunch, bundledNodePath, harnessBinPath, parseReadyUrl } from '../src/main/runtime.ts'
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
    expect(harnessBinPath({ kind: 'packaged', resourcesPath: '/res' }))
      .toBe('/res/dsh-runtime/lib/bin.js')
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
      { kind: 'packaged', resourcesPath: '/res' },
      paths,
      {},
    )
    expect(launch.command).toBe(bundledNodePath('/res'))
    expect(launch.command).toMatch(/node-runtime[\\/]node(\.exe)?$/)
    expect(launch.args).toEqual(['--expose-internals', '/res/dsh-runtime/lib/bin.js', 'web', '--host', '127.0.0.1', '--port', '0'])
    expect(launch.env['ELECTRON_RUN_AS_NODE']).toBeUndefined()
    expect(launch.env['DSH_HOME']).toBe(paths.dshHome)
  })

  it('never mutates the caller environment', () => {
    const base = { PATH: '/usr/bin' }
    buildHarnessLaunch({ kind: 'development', repoRoot: '/repo', nodeCommand: 'node' }, paths, base)
    expect(base).toEqual({ PATH: '/usr/bin' })
  })
})
