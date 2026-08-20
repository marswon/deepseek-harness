#!/usr/bin/env node
/**
 * Stage the production Harness runtime for electron-builder.
 *
 * pnpm workspaces resolve `@deepseek-ai/dsh` through links, which cannot ship
 * inside an app bundle. This script materializes a self-contained closure via
 * `pnpm deploy --legacy --prod` (the same route as
 * scripts/build-exe-for-python-sdk.ts), restores the direct dependencies the
 * legacy hoister drops beside the deploy source, replaces every remaining
 * symlink with real files, bundles a stock Node.js runtime for the target,
 * and verifies the payload can boot.
 *
 * Prerequisites: `pnpm run build` at the repository root (lib/ and
 * apps/web/dist must exist). Output: `$TMPDIR/dsh-desktop-staging/` — outside
 * the repository because the deploy's nested install resolves the workspace
 * root from any in-repo target and would prune its devDependencies.
 */
import { existsSync, globSync } from 'node:fs'
import { chmod, cp, lstat, mkdir, readdir, readFile, readlink, rm, stat } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Pinned Node.js runtime bundled for the Harness child; satisfies the repo engines (^22.19 || >=24). */
const NODE_RUNTIME_VERSION = '22.21.1'
/** Node.js dist mirror; npmmirror serves both China and global routes. */
const NODE_DIST_MIRROR = process.env['NODE_DIST_MIRROR'] ?? 'https://npmmirror.com/mirrors/node'

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = resolve(desktopDir, '../..')
// Staging lives OUTSIDE the repository: the legacy deploy's nested
// `install --production` resolves the nearest pnpm-workspace.yaml upward and
// would otherwise run at the workspace root, pruning its devDependencies.
const staging = join(tmpdir(), 'dsh-desktop-staging')
const cliSource = join(repoRoot, 'apps/cli')

function run(step, command, args) {
  console.log(`stage-runtime: ${step}: ${command} ${args.join(' ')}`)
  // CI=true keeps the legacy deploy's nested `install --production`
  // non-interactive (it purges the staging node_modules first).
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, CI: 'true' },
  })
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

/**
 * Fail loudly when the staged payload cannot serve the web UI.
 * @param platform - the staging target platform.
 */
async function verifyStagedPayload(platform) {
  for (const required of [
    join(staging, 'lib/bin.js'),
    join(staging, 'node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html'),
    join(staging, 'node_modules/node-pty/package.json'),
    join(staging, platform === 'win32' ? 'node-runtime/node.exe' : 'node-runtime/bin/node'),
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
 * Fetch a real Node.js runtime for the Harness child. Electron-as-Node is NOT
 * usable: Electron's V8 sandbox makes N-API raw-memory views fatal
 * (`koffi.view` in the win32 dialog worker crashes with
 * `Error::New napi_get_last_error_info`, reproduced on darwin too), and
 * node-pty's N-API prebuilds load under any Node 22/24, so a bundled stock
 * Node is strictly safer. Output: staging/node-runtime/ contains the complete
 * official Node.js distribution, including Corepack and npm. The plugin market
 * invokes Corepack to provide pnpm, so shipping node.exe alone leaves fresh
 * Windows machines unable to install plugins.
 * @param platform - target platform ('darwin' | 'win32' | 'linux').
 * @param arch - target arch ('arm64' | 'x64').
 */
async function fetchNodeRuntime(platform, arch) {
  const nodePlatform = platform === 'win32' ? 'win' : platform
  const archive = platform === 'win32'
    ? `node-v${NODE_RUNTIME_VERSION}-${nodePlatform}-${arch}.zip`
    : `node-v${NODE_RUNTIME_VERSION}-${nodePlatform}-${arch}.tar.gz`
  const url = `${NODE_DIST_MIRROR}/v${NODE_RUNTIME_VERSION}/${archive}`
  const tmp = join(desktopDir, '.node-tmp')
  await rm(tmp, { recursive: true, force: true })
  await mkdir(tmp, { recursive: true })
  try {
    const archivePath = join(tmp, archive)
    console.log(`stage-runtime: fetching Node.js runtime ${url}`)
    run('download', 'curl', ['-fsSL', '-o', archivePath, url])
    const destination = join(staging, 'node-runtime')
    await rm(destination, { recursive: true, force: true })
    const distributionDir = join(tmp, `node-v${NODE_RUNTIME_VERSION}-${nodePlatform}-${arch}`)
    if (platform === 'win32') {
      run('extract', 'unzip', ['-q', archivePath, '-d', tmp])
    } else {
      run('extract', 'tar', ['-xzf', archivePath, '-C', tmp])
    }
    await cp(distributionDir, destination, { recursive: true, dereference: false, verbatimSymlinks: true })
    if (platform !== 'win32') await chmod(join(destination, 'bin', 'node'), 0o755)
    console.log(`stage-runtime: bundled Node.js v${NODE_RUNTIME_VERSION} for ${platform}/${arch}`)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

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
  staging,
])
// pnpm legacy deploy leaves the source workspace production-only. Restore its
// declared development tools before returning: package scripts invoke
// electron-builder after staging in the same process tree.
run('restore workspace tools', process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', [
  'install',
  '--frozen-lockfile',
  '--prod=false',
])
await restoreLegacyHoists()
await materializeStagedLinks()
const { skipped, ranges: closureRanges } = await ensureRuntimeClosure()
if (targetPlatform !== undefined) {
  await fetchPlatformPackages(skipped, closureRanges, targetPlatform, targetArch ?? process.arch)
}
await fetchNodeRuntime(targetPlatform ?? process.platform, targetArch ?? process.arch)
await verifyStagedPayload(targetPlatform ?? process.platform)
console.log(`stage-runtime: staged Harness runtime at ${staging}`)
