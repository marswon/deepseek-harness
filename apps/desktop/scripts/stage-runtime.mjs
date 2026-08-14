#!/usr/bin/env node
/**
 * Stage the production Harness runtime for electron-builder.
 *
 * pnpm workspaces resolve `@deepseek-ai/dsh` through links, which cannot ship
 * inside an app bundle. This script materializes a self-contained closure via
 * `pnpm deploy --legacy --prod` (the same route as
 * scripts/build-exe-for-python-sdk.ts), restores the direct dependencies the
 * legacy hoister drops beside the deploy source, replaces every remaining
 * symlink with real files, and verifies the payload can boot.
 *
 * Prerequisites: `pnpm run build` at the repository root (lib/ and
 * apps/web/dist must exist). Output: apps/desktop/staging/.
 */
import { existsSync, globSync } from 'node:fs'
import { cp, lstat, mkdir, readdir, readFile, readlink, rm, stat } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = resolve(desktopDir, '../..')
const staging = join(desktopDir, 'staging')
const cliSource = join(repoRoot, 'apps/cli')

function run(step, command, args) {
  console.log(`stage-runtime: ${step}: ${command} ${args.join(' ')}`)
  // CI=true keeps the legacy deploy's nested `install --production`
  // non-interactive (it purges the staging node_modules first).
  const result = spawnSync(command, args, { cwd: repoRoot, stdio: 'inherit', env: { ...process.env, CI: 'true' } })
  if (result.status !== 0) throw new Error(`stage-runtime: ${step} failed with exit code ${String(result.status)}.`)
}

async function assertBuilt() {
  for (const required of [
    join(cliSource, 'lib/bin.js'),
    join(repoRoot, 'apps/web/dist/index.html'),
  ]) {
    if (!existsSync(required)) {
      throw new Error(`stage-runtime: ${required} missing — run \`pnpm run build\` from the repository root first.`)
    }
  }
}

/** Guard against clearing a directory that contains the repository root. */
function assertSafeStaging() {
  if (staging === repoRoot || repoRoot.startsWith(staging + sep)) {
    throw new Error(`stage-runtime: refusing to clear staging dir ${staging}: it contains the repo root.`)
  }
}

/**
 * The legacy hoister can place direct dependencies beside the deploy source
 * instead of into the target. Copy those from the CLI's own node_modules,
 * dereferenced and without nested node_modules, preserving one flat tree.
 */
async function restoreLegacyHoists() {
  const manifest = JSON.parse(await readFile(join(staging, 'package.json'), 'utf8'))
  const sourceNodeModules = join(cliSource, 'node_modules')
  const restored = []
  for (const dependency of Object.keys(manifest.dependencies ?? {}).sort()) {
    const destination = join(staging, 'node_modules', dependency)
    if (existsSync(destination)) continue
    const source = join(sourceNodeModules, dependency)
    if (!existsSync(source)) {
      throw new Error(`stage-runtime: deployed dependency ${dependency} is absent from both ${destination} and ${source}.`)
    }
    await mkdir(dirname(destination), { recursive: true })
    const nestedNodeModules = join(source, 'node_modules')
    await cp(source, destination, {
      recursive: true,
      dereference: true,
      filter: path => path !== nestedNodeModules && !path.startsWith(nestedNodeModules + sep),
    })
    restored.push(dependency)
  }
  if (restored.length > 0) console.log(`stage-runtime: restored legacy deploy hoists: ${restored.join(', ')}`)
}

/** Find the first symlink under a directory, depth-first. */
async function findSymlink(dir) {
  for (const entry of await readdir(dir)) {
    const path = join(dir, entry)
    const stats = await lstat(path)
    if (stats.isSymbolicLink()) return path
    if (stats.isDirectory()) {
      const nested = await findSymlink(path)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

/** Replace deploy-time links with real files; reject any surviving link. */
async function materializeStagedLinks() {
  const nodeModules = join(staging, 'node_modules')
  let remaining = await findSymlink(nodeModules)
  while (remaining !== undefined) {
    const target = await readlink(remaining)
    const resolved = resolve(dirname(remaining), target)
    if ((await stat(resolved)).isDirectory()) {
      await rm(remaining)
      await cp(resolved, remaining, { recursive: true, dereference: true })
    } else {
      await rm(remaining)
      await cp(resolved, remaining, { dereference: true })
    }
    remaining = await findSymlink(nodeModules)
  }
}

/** Fail loudly when the staged payload cannot serve the web UI. */
async function verifyStagedPayload() {
  for (const required of [
    join(staging, 'lib/bin.js'),
    join(staging, 'node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html'),
    join(staging, 'node_modules/node-pty/package.json'),
  ]) {
    if (!existsSync(required)) throw new Error(`stage-runtime: staged payload incomplete, missing ${required}.`)
  }
}

/**
 * Backstop the peer-dependency gap: the deploy runs with
 * auto-install-peers=false (one flat Cordis instance), so packages the
 * composition loads only through peer declarations (e.g.
 * @deepseek-ai/cordis-plugin-group, a peer of dsh-app-boot) never reach the
 * staging tree. Walk dependencies + peerDependencies from the CLI manifest
 * and copy anything missing, resolving the source through the repository's
 * own install so peer satisfaction matches development exactly.
 */
async function ensureRuntimeClosure() {
  const stagedNodeModules = join(staging, 'node_modules')
  // The deployed package itself lives at the staging root; the walk seeds
  // from its manifest's dependency sections.
  const rootManifest = JSON.parse(await readFile(join(staging, 'package.json'), 'utf8'))
  const queue = []
  // name → version range, recorded at enqueue time so a cross-target build
  // can fetch platform packages the host install never carries.
  const ranges = new Map()
  const enqueue = (sectionEntries) => {
    for (const [name, range] of sectionEntries) {
      if (name.startsWith('@types/')) continue // declaration-only, never loaded at runtime
      if (!ranges.has(name)) ranges.set(name, range)
      queue.push(name)
    }
  }
  const enqueueFrom = manifest => {
    enqueue(Object.entries(manifest.dependencies ?? {}))
    enqueue(Object.entries(manifest.peerDependencies ?? {}))
    enqueue(Object.entries(manifest.optionalDependencies ?? {}))
  }
  enqueueFrom(rootManifest)
  const seen = new Set()
  const restored = []
  const requireBases = globSync(['packages/*/*/package.json', 'vendor/*/package.json', 'apps/*/package.json'], { cwd: repoRoot })
    .map(manifest => createRequire(resolve(repoRoot, manifest)))
  const skipped = []
  const resolveSource = name => {
    for (const require of requireBases) {
      try {
        return dirname(require.resolve(`${name}/package.json`))
      } catch {
        // Not reachable from this base; try the next one.
      }
    }
    return undefined
  }
  while (queue.length > 0) {
    const name = queue.pop()
    if (seen.has(name)) continue
    seen.add(name)
    let base = join(stagedNodeModules, name)
    if (!existsSync(base)) {
      const source = resolveSource(name)
      if (source === undefined) {
        // Absent from the repository install as well: the runtime provably
        // never loads it (optional provider SDKs, other-platform binaries).
        skipped.push(name)
        continue
      }
      const nestedNodeModules = join(source, 'node_modules')
      await mkdir(dirname(base), { recursive: true })
      await cp(source, base, {
        recursive: true,
        dereference: true,
        filter: path => path !== nestedNodeModules && !path.startsWith(nestedNodeModules + sep),
      })
      restored.push(name)
      base = join(stagedNodeModules, name)
      // The restored package's own dependencies may only be reachable through
      // its source location in the repository install (isolated linker).
      requireBases.unshift(createRequire(join(source, 'package.json')))
    }
    const manifest = JSON.parse(await readFile(join(base, 'package.json'), 'utf8'))
    enqueueFrom(manifest)
  }
  if (restored.length > 0) console.log(`stage-runtime: restored peer-only closure packages: ${restored.join(', ')}`)
  if (skipped.length > 0) console.log(`stage-runtime: not in the repository install either, skipped: ${skipped.join(', ')}`)
  return { skipped, ranges }
}

const ARCH_TOKENS = ['x64', 'arm64', 'ia32', 'arm', 'riscv64', 'ppc64', 's390x', 'loong64', 'wasm32']

/**
 * Whether a skipped package name looks like a platform binary for the cross
 * target, e.g. `@koromix/koffi-win32-x64` for win32/x64.
 * @param name - package name.
 * @param platform - target platform token as embedded in package names.
 * @param arch - target arch token.
 */
function matchesPlatformPackage(name, platform, arch) {
  if (!name.includes(platform)) return false
  const tokens = ARCH_TOKENS.filter(token => name.includes(token))
  return tokens.length === 0 || tokens.includes(arch)
}

/**
 * Cross-target staging: fetch the target platform's optional binary packages
 * straight from the registry. pnpm only installs the host platform's
 * optionals and its supportedArchitectures array setting cannot be passed to
 * the deploy's nested install, so the target's koffi/ripgrep/N-API variants
 * are packed and unpacked into the flat tree directly.
 * @param skipped - packages the host install does not carry.
 * @param ranges - name → version range from the requiring manifests.
 * @param platform - target platform token.
 * @param arch - target arch token.
 */
async function fetchPlatformPackages(skipped, ranges, platform, arch) {
  const wanted = skipped.filter(name => matchesPlatformPackage(name, platform, arch))
  if (wanted.length === 0) return
  const tmp = join(desktopDir, '.fetch-tmp')
  await rm(tmp, { recursive: true, force: true })
  await mkdir(tmp, { recursive: true })
  try {
    for (const name of wanted) {
      const range = ranges.get(name) ?? 'latest'
      console.log(`stage-runtime: fetching ${name}@${range} for ${platform}/${arch}`)
      run('fetch', 'npm', ['pack', `${name}@${range}`, '--pack-destination', tmp, '--silent'])
      const { readdirSync } = await import('node:fs')
      const tarball = readdirSync(tmp).find(entry => entry.endsWith('.tgz'))
      if (tarball === undefined) throw new Error(`stage-runtime: npm pack produced no tarball for ${name}.`)
      const destination = join(staging, 'node_modules', name)
      await mkdir(destination, { recursive: true })
      run('extract', 'tar', ['-xzf', join(tmp, tarball), '-C', destination, '--strip-components=1'])
      await rm(join(tmp, tarball))
    }
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

await assertBuilt()
assertSafeStaging()
await rm(staging, { recursive: true, force: true })
// Optional cross-target override: `node scripts/stage-runtime.mjs win32 x64`
// fetches the target platform's optional binary packages (koffi, ripgrep,
// N-API shims) after the host-platform deploy, for cross-packaging without a
// native host. The deploy itself needs an empty target, so nothing may be
// pre-created inside staging.
const [targetPlatform, targetArch] = process.argv.slice(2)
run('deploy', process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', [
  '--filter',
  '@deepseek-ai/dsh',
  'deploy',
  '--legacy',
  '--prod',
  '--config.node-linker=hoisted',
  '--config.auto-install-peers=false',
  '--config.link-workspace-packages=true',
  // The deploy's deps-status probe otherwise re-runs `install --production`
  // at the workspace root and prunes development dependencies.
  '--config.verify-deps-before-run=false',
  staging,
])
await restoreLegacyHoists()
await materializeStagedLinks()
const { skipped, ranges: closureRanges } = await ensureRuntimeClosure()
if (targetPlatform !== undefined) {
  await fetchPlatformPackages(skipped, closureRanges, targetPlatform, targetArch ?? process.arch)
}
await verifyStagedPayload()
console.log(`stage-runtime: staged Harness runtime at ${staging}`)
