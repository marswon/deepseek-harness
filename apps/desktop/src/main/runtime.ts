import { cp, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { DesktopPaths } from './paths.ts'

/**
 * Where the Harness runtime comes from. Development runs the repository's
 * built CLI with the system Node; a packaged app stages its bundled
 * dsh-runtime into the desktop data root (see {@link stagePackagedRuntime})
 * and runs the copy under a bundled stock Node.js runtime.
 *
 * The Electron binary is deliberately NOT reused as Node
 * (`ELECTRON_RUN_AS_NODE`): Electron's V8 sandbox makes N-API raw-memory
 * views fatal — `koffi.view` in the win32 dialog worker crashes with
 * `Error::New napi_get_last_error_info` — while node-pty's N-API prebuilds
 * load under any stock Node 22/24, so a bundled Node is strictly safer.
 */
export type RuntimeMode =
  | { readonly kind: 'development'; readonly repoRoot: string; readonly nodeCommand: string }
  | { readonly kind: 'packaged'; readonly resourcesPath: string }

/**
 * The resolved runtime to actually launch from. Development is unchanged;
 * packaged points at the per-version staged copy under the desktop data root.
 */
export type HarnessRuntime =
  | { readonly kind: 'development'; readonly repoRoot: string; readonly nodeCommand: string }
  | { readonly kind: 'packaged'; readonly runtimeDir: string }

/** A fully-resolved Harness child invocation. */
export interface HarnessLaunch {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
}

/**
 * Absolute path of the built `dsh` bin for the runtime.
 * @param runtime - the resolved runtime.
 * @returns path to `lib/bin.js`; existence is guaranteed by the staging gate
 * for packaged builds and by the dev instructions for development.
 */
export function harnessBinPath(runtime: HarnessRuntime): string {
  switch (runtime.kind) {
    case 'development':
      return join(runtime.repoRoot, 'apps/cli/lib/bin.js')
    case 'packaged':
      return join(runtime.runtimeDir, 'lib/bin.js')
  }
}

/**
 * The bundled Node.js executable of a staged packaged runtime.
 * @param runtimeDir - the staged dsh-runtime directory.
 * @returns the node-runtime binary path for the current platform.
 */
export function bundledNodePath(runtimeDir: string): string {
  return join(runtimeDir, 'node-runtime', process.platform === 'win32' ? 'node.exe' : 'node')
}

/** Marker file proving a staged runtime copy completed. */
const STAGING_COMPLETE = '.dsh-runtime-complete'

/**
 * Stage the bundled dsh-runtime into `runtimeRoot/<version>` and return it.
 *
 * Windows locks the directory of every running executable and loaded DLL, so
 * launching node.exe (and its N-API modules) from inside the install
 * directory made the NSIS updater's close-and-replace unreliable — and once
 * produced a half-replaced, corrupt install. The staged copy under userData
 * leaves the install directory free of running processes.
 *
 * Staging is crash-safe: the copy lands in a sibling `.staging-*` directory
 * and is renamed into place only once the completion marker is written, so a
 * killed app never leaves a half-copied runtime behind. A directory with a
 * marker wins outright; anything else is rebuilt. Older versions are removed
 * after a successful stage.
 * @param resourcesPath - the app's resources directory (source of truth).
 * @param runtimeRoot - the desktop runtime staging root (paths.runtimeRoot).
 * @param version - the app version; one staged copy per version.
 * @returns the staged dsh-runtime directory to launch from.
 */
export async function stagePackagedRuntime(
  resourcesPath: string,
  runtimeRoot: string,
  version: string,
): Promise<string> {
  const source = join(resourcesPath, 'dsh-runtime')
  const target = join(runtimeRoot, version)
  await mkdir(runtimeRoot, { recursive: true })

  const entries = await readdir(runtimeRoot)
  if (existsSync(join(target, STAGING_COMPLETE))) {
    await pruneStaleRuntimes(entries, runtimeRoot, version)
    return target
  }

  // Partial or stale output: rebuild from scratch.
  await rm(target, { recursive: true, force: true })
  const staging = join(runtimeRoot, `.staging-${process.pid}`)
  await rm(staging, { recursive: true, force: true })
  await cp(source, staging, { recursive: true, dereference: true })
  await writeFile(join(staging, STAGING_COMPLETE), version, 'utf8')
  await rm(target, { recursive: true, force: true })
  await rename(staging, target)
  await pruneStaleRuntimes(entries, runtimeRoot, version)
  return target
}

/** Remove staged copies of other versions and leftover staging dirs; failures are cosmetic. */
async function pruneStaleRuntimes(
  entries: readonly string[],
  runtimeRoot: string,
  keepVersion: string,
): Promise<void> {
  for (const entry of entries) {
    if (entry === keepVersion) continue
    await rm(join(runtimeRoot, entry), { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Resolve the launchable runtime for the mode. Development passes through;
 * packaged first stages the bundled runtime under the desktop data root.
 * @param mode - the runtime source descriptor.
 * @param paths - the desktop filesystem layout.
 * @param version - the app version (one staged copy per version).
 * @returns the resolved runtime to launch from.
 */
export async function resolveHarnessRuntime(
  mode: RuntimeMode,
  paths: DesktopPaths,
  version: string,
): Promise<HarnessRuntime> {
  if (mode.kind === 'development') return mode
  const runtimeDir = await stagePackagedRuntime(mode.resourcesPath, paths.runtimeRoot, version)
  return { kind: 'packaged', runtimeDir }
}

/**
 * Assemble the Harness child invocation: `web --host 127.0.0.1 --port 0` on
 * the loopback with an OS-assigned port, `--expose-internals` so the Cordis
 * loader never needs the native `node-addon-require-builtin` fallback, and
 * `DSH_HOME` redirected into the desktop-owned data root.
 * @param runtime - the resolved runtime to launch from.
 * @param paths - the desktop filesystem layout.
 * @param baseEnv - environment to inherit (typically `process.env`).
 * @returns the launch spec; the port is only known once the child prints its
 * ready line — see {@link parseReadyUrl}.
 */
export function buildHarnessLaunch(runtime: HarnessRuntime, paths: DesktopPaths, baseEnv: NodeJS.ProcessEnv): HarnessLaunch {
  const env: NodeJS.ProcessEnv = { ...baseEnv, DSH_HOME: paths.dshHome }
  const webArgs = ['web', '--host', '127.0.0.1', '--port', '0']
  switch (runtime.kind) {
    case 'development':
      return {
        command: runtime.nodeCommand,
        args: ['--expose-internals', harnessBinPath(runtime), ...webArgs],
        cwd: paths.launchRoot,
        env,
      }
    case 'packaged':
      return {
        command: bundledNodePath(runtime.runtimeDir),
        args: ['--expose-internals', harnessBinPath(runtime), ...webArgs],
        cwd: paths.launchRoot,
        env,
      }
  }
}

/**
 * Parse the Harness readiness signal. The web bundle prints exactly one URL
 * line after the whole plugin tree has settled; supervisors may connect as
 * soon as they observe it.
 * @param line - one stdout line from the Harness child.
 * @returns the loopback URL including the actual port, or null for any other line.
 */
export function parseReadyUrl(line: string): string | null {
  const match = /^dsh web: (http:\/\/\S+)$/.exec(line.trim())
  return match?.[1] ?? null
}
