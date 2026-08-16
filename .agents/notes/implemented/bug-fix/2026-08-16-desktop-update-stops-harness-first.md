# Agent Note: Windows update install failed because the Harness child outlived the quit

Status: implemented

English | [中文](2026-08-16-desktop-update-stops-harness-first.zh.md)

## Problem

On Windows, clicking Restart in the update-ready dialog surfaced the NSIS installer's "DeepSeek Harness cannot be closed" prompt, and retrying never proceeded. Root cause is an ordering fact in electron-updater's `BaseUpdater.quitAndInstall`: it spawns the NSIS installer **before** quitting the app. The desktop shell's supervised `dsh web` child (the bundled `node.exe` under the install directory's `resources/`) was still alive when the installer enumerated locked files, so every retry kept failing while the child outlived the quit handshake.

## Decision

**Stop the Harness child before calling `quitAndInstall`.** `setupAutoUpdater` gains a `prepareForInstall?: () => Promise<void>` option; the Restart dialog handler awaits it (failures are logged and cannot block the install) and only then calls `autoUpdater.quitAndInstall()`. The shell entry passes a callback that sets the `quitting` flag and awaits `harness.stop()` — so by the time the installer spawns, no process holds files under the install directory, and the subsequent `before-quit` returns immediately (the flag is already set) instead of re-running the graceful stop inside the prevented-quit window.

## Alternatives considered

**Letting NSIS kill the app itself.** electron-builder's installer include already tries; it cannot know about our generically-named `node.exe` child, which is the file locker that matters. The close has to happen in our process, before the installer starts.

**Racing the installer with a fast enough before-quit.** That is what the old code did; it is a race by construction because the installer is already running while the graceful stop is in flight.

## Consequences

macOS is untouched (its unsigned builds use the manual-download update flow). The behavior is pinned by `apps/desktop/tests/updater.spec.ts`, which mocks both electron modules and drives the win32/darwin branches across `process.platform` stubs — including the ordering assertion (`prepare` before `quitAndInstall`) and the prepare-failure path.
