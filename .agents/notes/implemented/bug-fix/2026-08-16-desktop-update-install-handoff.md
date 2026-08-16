# Agent Note: own the desktop update install handoff

Status: implemented

English | [中文](2026-08-16-desktop-update-install-handoff.zh.md)

## Problem

Windows updates repeatedly stranded users on the NSIS "cannot be closed" prompt, across three compounding causes. First, electron-updater's `quitAndInstall` spawns the installer and quits the app concurrently, racing the NSIS running-process gate against the app's own shutdown. Second — the decisive one — an installer that died on that dialog keeps the per-app installer mutex held: every later update attempt aborts on `ERROR_ALREADY_EXISTS` and raises the zombie's own stale dialog, so the user sees the same prompt no matter what they close (a `DeepSeek-Harness-Setup-0.1.0-rc.12.exe` process survived for days on one affected machine). Third, on macOS Squirrel.Mac enforces signature equality against ad-hoc builds whose designated requirement is a per-binary cdhash, so in-place updates could never succeed — the updater downloaded ~200 MB and then failed validation.

Separately, dshmarket's plugin installs spawn `corepack`/`npm` by name, but the packaged Harness child's PATH lacked the bundled Node bin directory, so setup failed with `spawn corepack ENOENT` and fell back to a global npm install needing sudo.

## Decision

**Own the install handoff; let electron-updater only check and download.** The pattern follows anywhere-labs/deepseek-harness-desktop's self-hosted updater, adapted to keep our GitHub Releases feed and differential downloads.

- Windows: resolve the pending installer from `app-update.yml`'s `updaterCacheDirName` plus electron-updater's base-cache rule, force-stop any process still running from the pending directory (frees the installer mutex), spawn the installer detached with `--updated --force-run`, and quit only after the spawn succeeds. When the pending path cannot be resolved, fall back to `quitAndInstall`.
- macOS: download the dmg from the release into `userData/updates/<version>`, open it, and show drag-replace instructions; a failed download offers the release page.
- NSIS: `build/installer.nsh` defines `customCheckAppRunning`, replacing the stock running-process gate's retry dialog with a prompt-free force kill by image name.
- Packaged child PATH prepends the bundled `node-runtime` bin directory so plugins can spawn corepack/npm/npx.

## Alternatives considered

**Keep quitAndInstall and only speed up the app quit.** rc.15 already quit promptly after stopping the Harness child and updates still failed; the zombie-mutex failure lives outside the app's quit path. Rejected.

**Wait for a Developer ID signature to enable Squirrel.Mac.** Signing is orthogonal and unscheduled; the dmg-download flow serves the unsigned present and stays correct once signing exists. Rejected as a blocker.

**Uninstall-then-install inside the update.** The oneClick NSIS installer already runs the old uninstaller during install; the blockers were the process gate and the mutex, not file replacement. Rejected as addressing the wrong layer.

## Consequences

macOS users install updates by dragging from an opened dmg; restart-to-update exists only on Windows. The custom NSIS gate force-kills any running app instance during install and uninstall without asking. Downloaded dmgs accumulate under `userData/updates/` (one per release, no cleanup). Behavior coverage: `apps/desktop/tests/updater.spec.ts` (spawn ordering, stale-installer sweep, quitAndInstall fallback, dmg download/open, failure fallback) and `runtime.spec.ts` (PATH composition).
