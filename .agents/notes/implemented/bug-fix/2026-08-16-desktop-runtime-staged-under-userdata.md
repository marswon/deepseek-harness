# Agent Note: stage the packaged runtime under userData, out of the install directory

Status: implemented

English | [中文](2026-08-16-desktop-runtime-staged-under-userdata.zh.md)

## Problem

Windows locks the directory of every running executable and loaded DLL. The desktop shell launched its supervised `dsh web` child — the bundled `node.exe` plus the whole `dsh-runtime` N-API tree — from inside the install directory, so the NSIS updater had to close-and-replace a directory full of live processes. In the field this produced both the "cannot be closed" retry loop (see [the quit-ordering note](2026-08-16-desktop-update-stops-harness-first.md), which fixed only the ordering) and, worse, one corrupted half-replaced install whose child then failed with `ERR_MODULE_NOT_FOUND` on every boot until a manual reinstall.

## Decision

**Run the runtime from a per-version staged copy under the desktop data root.** On first launch (and after every update, keyed by `app.getVersion()`), `stagePackagedRuntime` copies `resources/dsh-runtime` to `<userData>/runtimes/<version>-<platform>-<arch>` and the child launches from the copy; the copy earns its completion marker only after its Node passes a `node --version` probe (see [the arch-keyed staging note](2026-08-21-desktop-runtime-arch-keyed-staging.md)). The install directory then hosts only Electron itself, which the NSIS close/kill path handles reliably; nothing the Harness runs can lock files the installer must replace. Staging is crash-safe — the copy lands in a `.staging-*` sibling and is renamed into place only after the probe passes and the completion marker is written, so a killed app never leaves a half-copied runtime; older versions and stale staging dirs are pruned after a successful stage. `resolveHarnessRuntime` wraps this so development mode passes through unchanged.

## Alternatives considered

**Uninstall-then-install updates.** The NSIS uninstaller runs the same running-process gate (`CHECK_APP_RUNNING`), and the failure mode is processes locking `$INSTDIR`, not install ordering — uninstalling first changes nothing.

**Only fixing the quit ordering** (the previous note). Necessary but insufficient: even with a perfect quit handshake, any grandchild process the Harness spawned from the runtime tree (worker threads are processes here) outlives it and re-locks the directory.

## Consequences

First launch after install or update pays a one-time runtime copy (a few seconds on an SSD, behind the existing starting page); subsequent launches reuse the staged copy via the marker. Disk cost is one extra runtime copy per current version (old versions are pruned). `apps/desktop/tests/runtime.spec.ts` pins the fresh-copy, reuse, crash-recovery, and version-change paths with real filesystem fixtures. The `prepareForInstall` quit-ordering fix stays — a dead child still makes the updater's job shorter.
