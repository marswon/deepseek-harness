import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Filesystem layout owned by the desktop shell under Electron's userData
 * directory. Everything user-produced lives here so app upgrades never touch
 * profiles, sessions, credentials, or logs.
 */
export interface DesktopPaths {
  /** Electron userData root. */
  readonly userData: string
  /** `$DSH_HOME` for the Harness child: profiles, sessions, settings, credentials. */
  readonly dshHome: string
  /**
   * Default project directory for sessions created without a cwd; the Harness
   * child starts here so the UI never opens with a directory prompt.
   */
  readonly launchRoot: string
  /** Directory receiving the Harness child log. */
  readonly logDir: string
  /** Harness child stdout/stderr log, viewed from the recovery page and menu. */
  readonly logFile: string
  /**
   * Per-version staged runtime roots. A packaged build copies its bundled
   * dsh-runtime here and launches from the copy: Windows locks the directory
   * of a running executable, so launching from the install directory made the
   * NSIS updater's close-and-replace unreliable (and once produced a corrupt
   * half-replaced install). Staging under userData keeps the install
   * directory free of running processes.
   */
  readonly runtimeRoot: string
}

/**
 * Resolve the desktop layout under a userData root.
 * @param userData - Electron's `app.getPath('userData')`.
 * @returns the layout paths; nothing is created on disk.
 */
export function resolveDesktopPaths(userData: string): DesktopPaths {
  const dshHome = join(userData, 'harness')
  const logDir = join(userData, 'logs')
  return {
    userData,
    dshHome,
    launchRoot: join(userData, 'launch-root'),
    logDir,
    logFile: join(logDir, 'harness.log'),
    runtimeRoot: join(userData, 'runtimes'),
  }
}

/**
 * Create every directory of the layout. Safe to call on every launch.
 * @param paths - the layout to materialize.
 */
export async function ensureDesktopPaths(paths: DesktopPaths): Promise<void> {
  await Promise.all([paths.dshHome, paths.launchRoot, paths.logDir, paths.runtimeRoot].map(dir => mkdir(dir, { recursive: true })))
}
