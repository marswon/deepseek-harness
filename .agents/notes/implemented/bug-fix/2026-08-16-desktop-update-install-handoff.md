# Agent Note: own the desktop update install handoff

Status: implemented

English | [中文](2026-08-16-desktop-update-install-handoff.zh.md)

## Problem

Windows updates repeatedly stranded users on the NSIS "cannot be closed" prompt. electron-updater's `quitAndInstall` races installer launch with the app shutdown; an installer that dies on that dialog retains the per-app mutex and re-raises its stale prompt on later attempts. The earlier custom NSIS hook killed by image name but did not prove handles had gone before replacement. On macOS Squirrel.Mac rejects in-place updates of ad-hoc signed builds because their designated requirement contains a per-binary cdhash; unnotarized replacement dmgs also make Gatekeeper ask users to open the app again.

dshmarket needs Corepack and pnpm, but the packaged runtime contained only the Node interpreter. Its restart action can additionally create an unmanaged `dsh web` process while the Electron window remains attached to the old port.

## Decision

**Own the install handoff; let electron-updater only check and download.** The pattern follows anywhere-labs/deepseek-harness-desktop's self-hosted updater, adapted to keep our GitHub Releases feed and differential downloads.

- Windows: resolve the pending installer from `app-update.yml`'s `updaterCacheDirName`, force-stop installers from that directory, then spawn a detached PowerShell waiter. The waiter starts NSIS with `--updated --force-run` only after the Electron PID is absent. When the pending path cannot be resolved, fall back to `quitAndInstall`.
- NSIS: `build/installer.nsh` replaces the stock running-process dialog with a force kill and bounded process poll before replacement.
- macOS: download the dmg into `userData/updates/<version>`, open it, and show drag-replace instructions. The tag release workflow supplies Developer ID credentials and explicitly enables notarization, so the replacement remains trusted.
- The [bundled Node runtime](2026-08-14-desktop-bundled-node-runtime.md) carries Corepack and npm. The desktop overlay disables dshmarket's unmanaged restart; the Electron menu owns Harness restarts.

## Alternatives considered

**Keep quitAndInstall and only speed up the app quit.** rc.15 already quit promptly after stopping the Harness child and updates still failed; the zombie-mutex failure lives outside the app's quit path. Rejected.

**Keep release builds ad-hoc signed.** A manual dmg flow avoids Squirrel.Mac's signature check but does not make a replacement trusted by Gatekeeper. Tagged builds must use the available Developer ID credentials and notarization. Rejected.

**Uninstall-then-install inside the update.** The oneClick NSIS installer already runs the old uninstaller during install; the blockers were the process gate and the mutex, not file replacement. Rejected as addressing the wrong layer.

## Consequences

macOS users install updates by dragging from an opened dmg; restart-to-update exists only on Windows. The custom NSIS gate force-kills a running app image and waits up to five seconds for it to disappear. Downloaded dmgs accumulate under `userData/updates/` (one per release, no cleanup). The full Node distribution increases the packaged payload but makes plugin installation self-contained. Behavior coverage: `apps/desktop/tests/updater.spec.ts` (waiter scheduling, stale-installer sweep, fallback, dmg download/open), `runtime.spec.ts` (launch and overlay arguments), and `paths.spec.ts` (desktop dshmarket overlay).
