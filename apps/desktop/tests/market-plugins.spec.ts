import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { disableMarketPlugins, INBOX_PROFILE_BUNDLES, WINDOWS_QUARANTINED_BUNDLES } from '../src/main/market-plugins.ts'

const dirs: string[] = []

async function tempDshHome(): Promise<{ dshHome: string; logDir: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-market-'))
  dirs.push(root)
  const dshHome = join(root, 'harness')
  const logDir = join(root, 'logs')
  await mkdir(logDir, { recursive: true })
  return { dshHome, logDir }
}

async function writeProfile(dshHome: string, manifest: unknown): Promise<string> {
  const dir = join(dshHome, 'profiles', 'web')
  await mkdir(dir, { recursive: true })
  const file = join(dir, 'package.json')
  await writeFile(file, JSON.stringify(manifest, null, 2), 'utf8')
  return file
}

afterEach(async () => {
  dirs.length = 0
})

describe('disableMarketPlugins', () => {
  it('returns no removals when the profile manifest does not exist yet', async () => {
    // A fresh install has never run the Harness child, so
    // profiles/web/package.json has not been created from
    // PROFILE_TEMPLATES.web yet. Reading it must not throw ENOENT.
    const { dshHome, logDir } = await tempDshHome()
    await expect(disableMarketPlugins(dshHome, logDir)).resolves.toEqual([])
  })

  it('removes only the requested dependency, keeping in-box bundles', async () => {
    const { dshHome, logDir } = await tempDshHome()
    const manifestFile = await writeProfile(dshHome, {
      name: 'dsh-profile-web',
      dependencies: { '@deepseek-ai/dsh-base': '1.0.0', '@linxin666/dsh-web-ui-all': '^0.1.16' },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'dshmarket', '@linxin666/dsh-web-ui-all'] } },
    })

    const removed = await disableMarketPlugins(dshHome, logDir, WINDOWS_QUARANTINED_BUNDLES)

    expect(removed).toEqual(['@linxin666/dsh-web-ui-all'])
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8'))
    expect(manifest.dependencies).toEqual({ '@deepseek-ai/dsh-base': '1.0.0' })
    expect(manifest.dsh.profile.bundles).toEqual(['@deepseek-ai/dsh-base', 'dshmarket'])
  })

  it('removes every non-in-box dependency when no filter is given', async () => {
    const { dshHome, logDir } = await tempDshHome()
    const manifestFile = await writeProfile(dshHome, {
      dependencies: {
        '@deepseek-ai/dsh-base': '1.0.0',
        '@deepseek-ai/dsh-web-app': '1.0.0',
        'some-other-plugin': '2.0.0',
      },
    })

    const removed = await disableMarketPlugins(dshHome, logDir)

    expect(removed).toEqual(['some-other-plugin'])
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8'))
    expect(Object.keys(manifest.dependencies)).toEqual(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
  })

  it('never removes in-box bundles even when explicitly named', async () => {
    const { dshHome, logDir } = await tempDshHome()
    await writeProfile(dshHome, { dependencies: { '@deepseek-ai/dsh-base': '1.0.0' } })

    const removed = await disableMarketPlugins(dshHome, logDir, INBOX_PROFILE_BUNDLES)

    expect(removed).toEqual([])
  })

  it('backs up the manifest before rewriting it', async () => {
    const { dshHome, logDir } = await tempDshHome()
    await writeProfile(dshHome, { dependencies: { 'some-plugin': '1.0.0' } })

    await disableMarketPlugins(dshHome, logDir)

    const { readdir } = await import('node:fs/promises')
    const backups = (await readdir(logDir)).filter(name => name.startsWith('web-profile-before-recovery-'))
    expect(backups).toHaveLength(1)
    const backup = JSON.parse(await readFile(join(logDir, backups[0]!), 'utf8'))
    expect(backup.dependencies).toEqual({ 'some-plugin': '1.0.0' })
  })

  it('writes nothing back when there is nothing to remove', async () => {
    const { dshHome, logDir } = await tempDshHome()
    const manifestFile = await writeProfile(dshHome, { dependencies: { '@deepseek-ai/dsh-base': '1.0.0' } })
    const before = await readFile(manifestFile, 'utf8')

    const removed = await disableMarketPlugins(dshHome, logDir, WINDOWS_QUARANTINED_BUNDLES)

    expect(removed).toEqual([])
    expect(await readFile(manifestFile, 'utf8')).toBe(before)
  })
})
