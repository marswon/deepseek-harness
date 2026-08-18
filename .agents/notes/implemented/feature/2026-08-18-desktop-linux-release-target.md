# Agent Note: ship the desktop shell on Linux, deb first

Status: implemented

English | [中文](2026-08-18-desktop-linux-release-target.zh.md)

## Problem

`electron-builder.yml` declared AppImage and deb targets, `stage-runtime.mjs` already handled the linux Node distribution, and the sandbox seam was Linux-first (bwrap then landlock-run, functionally probed). Nothing published them, and three defects sat in the untested paths:

`setupAutoUpdater` branched on `darwin` and let every other platform fall into the Windows path. On Linux that reached `pendingInstallerPath()` (reconstructing a `%LOCALAPPDATA%` path from `app-update.yml`) and `killStaleInstallers()` (spawning `powershell.exe`), then landed on `quitAndInstall()` by accident once the reconstruction failed, logging Windows-specific wording throughout. Restart-to-update happened to work through that accident, so no symptom pointed at the cause.

The Linux section carried no `artifactName`, so `productName: DeepSeek Harness` would have produced `DeepSeek Harness-<version>.AppImage` — the same space defect the mac section already documents (GitHub rewrites spaces to dots on upload while `latest*.yml` references the hyphenated form, 404ing the updater).

Ubuntu 24.04 and later set `kernel.apparmor_restrict_unprivileged_userns=1`, which denies Electron's sandbox a user namespace. Ubuntu 26.04 also drops the Xorg session, and Electron 37 still defaults `--ozone-platform` to `x11`, so the window would render through XWayland with blurry fractional scaling.

## Decision

**Publish deb as the primary Linux format, AppImage as a convenience artifact, both on x64 and arm64.** Only a package with a maintainer script can install the AppArmor profile that restores the sandbox, so electron-builder's `after-install` hook writing `/etc/apparmor.d/DeepSeek-Harness` is the deciding capability. An AppImage runs no install script; electron-builder's launcher probes `unshare -Ur true` and adds `--no-sandbox` when user namespaces are unavailable, so it starts with an unsandboxed renderer. The README states that tradeoff and points users at the deb.

- `setupAutoUpdater` gains an explicit `linux` branch (`setupLinuxUpdater`). electron-updater already selects AppImageUpdater or DebUpdater from `resources/package-type`, so the install is `quitAndInstall()` after the Harness child is stopped — no pending-installer path, no `powershell.exe`. The restart dialog names the pkexec/sudo prompt for deb and omits it for AppImage. A refused check (`isUpdaterActive()` false for an AppImage without its runtime, which resolves null and emits no event) reports that updates are unavailable instead of leaving a dead menu item.
- Linux gets the space-free `artifactName`, an explicit `maintainer` (fpm rejects a bare name), `syncDesktopName: true` plus `desktopName` in package.json so the `.desktop` filename, `StartupWMClass`, and Electron's `app_id` agree and GNOME associates the window with its launcher icon, and `libgbm1` added to the deb depends for native Wayland.
- `ozonePlatformHint()` (`src/main/linux-display.ts`) returns `'auto'` on Linux and null everywhere else, and defers to `ELECTRON_OZONE_PLATFORM_HINT` or an explicit `--ozone-platform*` argument. `index.ts` applies it at module scope because command-line switches only take effect before the app is ready.
- CI packages `linux-x64` on `ubuntu-24.04` and `linux-arm64` on `ubuntu-24.04-arm`.

## Alternatives considered

**Ship AppImage only, as the more portable single-file format.** It cannot install an AppArmor profile, so on Ubuntu 24.04+ it either fails to start or runs unsandboxed. Making the more common Ubuntu configuration the degraded one inverts the priority; the deb keeps `sandbox: true` meaningful. Rejected as primary, retained as a secondary artifact for non-deb distributions.

**Drop AppImage entirely.** The `--no-sandbox` fallback is electron-builder's own behavior and still serves distributions without dpkg. Removing it would leave those users nothing. Rejected.

**Cross-compile arm64 from an x64 runner.** `verify-target.mjs` refuses a host/target mismatch because node-pty prebuilds and the landlock launcher ship per platform, and the `package:win:cross` exception exists only because a registry fetch can supply the win32 binaries. Hosted `ubuntu-24.04-arm` runners make the workaround unnecessary. Rejected.

**Build on ubuntu-26.04 to match the target.** glibc is backward but not forward compatible, so a 26.04 build would refuse to run on 24.04 while a 24.04 build runs on both. The 26.04 runner image is also still in public preview. Rejected.

**Rename `productName` to `DeepSeek-Harness` to remove the space at the source.** `productName` is global: it renames the macOS `.app` and the Windows install directory, invalidating the update paths that were just stabilized. The Linux-local `artifactName` override reaches the same artifact names with no cross-platform blast radius. Rejected.

## Consequences

Linux releases carry four artifacts plus blockmaps and `latest-linux*.yml`. The deb keeps Electron's sandbox; the AppImage runs unsandboxed on Ubuntu 24.04+, and an arm64 AppImage additionally needs host `libfuse2` because the FUSE2 toolset ships runtime libraries for x64/ia32 only. Passing `--ozone-platform-hint=auto` opts into native Wayland one Electron version before it becomes the default, so a compositor bug surfaces here first; the environment and argument escapes exist for exactly that.

Behavior coverage: `apps/desktop/tests/updater.spec.ts` (Linux hands off to electron-updater and touches neither the pending-installer path nor `powershell.exe`; deb versus AppImage dialog wording; a refused check reports instead of going silent) and `tests/linux-display.spec.ts` (the hint applies only on Linux and never overrides an explicit choice). Not verified: no Linux packaging or install has been executed — the deb's AppArmor profile installation, the t64 dependency resolution on 24.04+, `bwrap` availability on a 26.04 desktop, and the packaged Harness child booting under the bundled Node all remain untested on a real machine.
