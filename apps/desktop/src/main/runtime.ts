import { join } from 'node:path'
import type { DesktopPaths } from './paths.ts'

/**
 * Where the Harness runtime comes from. Development runs the repository's
 * built CLI with the system Node; a packaged app runs the staged runtime
 * closure with the Node.js runtime bundled under `dsh-runtime/node-runtime`.
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

/** A fully-resolved Harness child invocation. */
export interface HarnessLaunch {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
}

/**
 * Absolute path of the built `dsh` bin for the mode.
 * @param mode - the runtime source.
 * @returns path to `lib/bin.js`; existence is verified by the staging gate for
 * packaged builds and by the dev instructions for development.
 */
export function harnessBinPath(mode: RuntimeMode): string {
  switch (mode.kind) {
    case 'development':
      return join(mode.repoRoot, 'apps/cli/lib/bin.js')
    case 'packaged':
      return join(mode.resourcesPath, 'dsh-runtime/lib/bin.js')
  }
}

/**
 * The bundled Node.js executable for a packaged build.
 * @param resourcesPath - the app's resources directory.
 * @returns the node-runtime binary path for the current platform.
 */
export function bundledNodePath(resourcesPath: string): string {
  return join(resourcesPath, 'dsh-runtime/node-runtime', process.platform === 'win32' ? 'node.exe' : 'node')
}

/**
 * Assemble the Harness child invocation: `web --host 127.0.0.1 --port 0` on
 * the loopback with an OS-assigned port, `--expose-internals` so the Cordis
 * loader never needs the native `node-addon-require-builtin` fallback, and
 * `DSH_HOME` redirected into the desktop-owned data root.
 * @param mode - the runtime source.
 * @param paths - the desktop filesystem layout.
 * @param baseEnv - environment to inherit (typically `process.env`).
 * @returns the launch spec; the port is only known once the child prints its
 * ready line — see {@link parseReadyUrl}.
 */
export function buildHarnessLaunch(mode: RuntimeMode, paths: DesktopPaths, baseEnv: NodeJS.ProcessEnv): HarnessLaunch {
  const env: NodeJS.ProcessEnv = { ...baseEnv, DSH_HOME: paths.dshHome }
  const webArgs = ['web', '--host', '127.0.0.1', '--port', '0']
  switch (mode.kind) {
    case 'development':
      return {
        command: mode.nodeCommand,
        args: ['--expose-internals', harnessBinPath(mode), ...webArgs],
        cwd: paths.launchRoot,
        env,
      }
    case 'packaged':
      return {
        command: bundledNodePath(mode.resourcesPath),
        args: ['--expose-internals', harnessBinPath(mode), ...webArgs],
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
