import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Bundles shipped in-box; never removed by {@link disableMarketPlugins}. */
export const INBOX_PROFILE_BUNDLES = new Set([
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
  '@deepseek-ai/dsh-headless',
])

/**
 * Known Windows-incompatible community bundle: installing it crashes the
 * packaged Harness child with exit code 3221226505 (STATUS_STACK_BUFFER_OVERRUN,
 * 0xC0000409) before any window opens, stranding the user on every subsequent
 * launch until the profile is edited by hand.
 */
export const WINDOWS_QUARANTINED_BUNDLES = new Set(['@linxin666/dsh-web-ui-all'])

/** The slice of the profile manifest this module reads and rewrites. */
interface ProfileManifest {
  dependencies?: Record<string, string>
  dsh?: { profile?: { bundles?: string[] } }
}

/**
 * Remove selected community profile dependencies, preserving in-box bundles.
 * A profile manifest that does not exist yet (a fresh install, before the
 * Harness child has ever created one from `PROFILE_TEMPLATES.web`) has
 * nothing to quarantine.
 * @param dshHome - `$DSH_HOME` for the Harness child (paths.dshHome).
 * @param logDir - directory receiving the pre-recovery manifest backup.
 * @param only - dependency names to consider; every non-in-box dependency
 * when omitted.
 * @returns the removed dependency names, in manifest order.
 */
export async function disableMarketPlugins(
  dshHome: string,
  logDir: string,
  only?: ReadonlySet<string>,
): Promise<string[]> {
  const manifestFile = join(dshHome, 'profiles', 'web', 'package.json')
  if (!existsSync(manifestFile)) return []
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8')) as ProfileManifest
  const dependencies = manifest.dependencies ?? {}
  const removed = Object.keys(dependencies).filter(name => !INBOX_PROFILE_BUNDLES.has(name) && (only === undefined || only.has(name)))
  if (removed.length === 0) return removed
  await writeFile(join(logDir, `web-profile-before-recovery-${Date.now()}.json`), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  manifest.dependencies = Object.fromEntries(Object.entries(dependencies).filter(([name]) => !removed.includes(name)))
  if (Array.isArray(manifest.dsh?.profile?.bundles)) {
    manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter(name => !removed.includes(name))
  }
  await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  return removed
}
