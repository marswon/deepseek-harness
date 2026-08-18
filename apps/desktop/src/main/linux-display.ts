/**
 * Ozone platform selection for Linux sessions.
 *
 * Electron 37 still defaults `--ozone-platform` to `x11`, so a Wayland session
 * runs the window through XWayland: fractional scaling renders blurry and
 * Wayland-native input methods behave inconsistently. Electron 38 changes the
 * default to `auto` and removes `ELECTRON_OZONE_PLATFORM_HINT`, so passing the
 * hint explicitly now matches where Electron is going while keeping one code
 * path across both versions.
 */

/** The switch Electron reads to choose an Ozone backend. */
export const OZONE_PLATFORM_HINT_SWITCH = 'ozone-platform-hint'

/**
 * The `ozone-platform-hint` value to apply before the app is ready.
 *
 * Returns null when the switch must not be set: on non-Linux platforms, and
 * whenever the user or session already made the choice — an explicit
 * `--ozone-platform*` argument, or `ELECTRON_OZONE_PLATFORM_HINT` in the
 * environment (which Electron 37 honors on its own). Overriding either would
 * silently discard a deliberate workaround for a compositor bug.
 * @param platform - the running platform (`process.platform`).
 * @param env - the process environment.
 * @param argv - the process arguments (`process.argv`).
 * @returns `'auto'`, or null to leave Electron's default untouched.
 */
export function ozonePlatformHint(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  argv: readonly string[],
): 'auto' | null {
  if (platform !== 'linux') return null
  if (env['ELECTRON_OZONE_PLATFORM_HINT'] !== undefined) return null
  if (argv.some(arg => arg === '--ozone-platform' || arg.startsWith('--ozone-platform='))) return null
  if (argv.some(arg => arg === '--ozone-platform-hint' || arg.startsWith('--ozone-platform-hint='))) return null
  return 'auto'
}
