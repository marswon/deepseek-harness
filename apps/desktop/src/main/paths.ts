import { mkdir, writeFile } from 'node:fs/promises'
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
  /** Desktop-owned Cordis overlay applied after user profile patches. */
  readonly desktopPatchFile: string
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
    desktopPatchFile: join(userData, 'desktop.patch.yml'),
    logDir,
    logFile: join(logDir, 'harness.log'),
    runtimeRoot: join(userData, 'runtimes'),
  }
}

const DESKTOP_PATCH = `- id: dsh-market
  config:
    profile: web
    allowRestart: false
`

/**
 * Create every directory of the layout and refresh the app-owned overlay. The
 * overlay keeps dshmarket from starting an unmanaged replacement web process;
 * the Electron menu owns the Harness restart instead.
 * @param paths - the desktop layout to materialize.
 */
export async function ensureDesktopPaths(paths: DesktopPaths): Promise<void> {
  await Promise.all([paths.dshHome, paths.launchRoot, paths.logDir, paths.runtimeRoot].map(dir => mkdir(dir, { recursive: true })))
  await writeFile(paths.desktopPatchFile, DESKTOP_PATCH, 'utf8')
}
