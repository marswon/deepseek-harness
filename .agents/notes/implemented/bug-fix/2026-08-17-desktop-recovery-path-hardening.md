# Agent Note: harden the desktop recovery path against its own failure modes

Status: implemented

English | [中文](2026-08-17-desktop-recovery-path-hardening.zh.md)

## Problem

The Windows market-plugin quarantine and crash-recovery action ([recover from broken market plugins](../feature/2026-08-16-bundle-dshmarket-into-web-profile.md) built on top of it) read `profiles/web/package.json` with no existence check and no `.catch()` on the `app.whenReady()` chain that calls it. A fresh install has never run the Harness child, so `PROFILE_TEMPLATES.web` has not materialized that file yet (`packages/boot/app-boot/src/profile.ts`'s `loadProfile`/`initProfile` only runs inside the child); `readFile` on it throws `ENOENT`, and the rejection had nothing above it in `index.ts` to catch it. Electron turns an unhandled rejection in a `whenReady` continuation into a silent stall: no window, no log line, no recovery page — every user on a brand-new Windows install would hit this before ever seeing the app, which is strictly worse than the native-crash case the recovery path exists to handle.

Separately, `build/installer.nsh`'s process-exit poll called `nsExec::ExecToStack` but only `Pop`ped the return code. `ExecToStack` pushes the return code and then the captured output text; leaving the second value on the shared NSIS variable stack for up to 20 loop iterations desyncs every later unconditional `Pop` in the same installer run (electron-builder's own template code included), a latent installer-corruption path with no local check to catch it — `makensis` and `--config.win.signAndEditExecutable=false` cross-builds compile it clean either way.

## Decision

**Treat an absent profile manifest as "nothing to quarantine," and give `whenReady` a terminal catch.** `disableMarketPlugins` (extracted to `src/main/market-plugins.ts`, unit-testable independent of Electron) now returns `[]` via `existsSync` before reading the manifest. The `app.whenReady().then(...)` chain in `index.ts` gains a `.catch()` that logs the failure and renders the existing failed shell page — the same page the runtime-resolution and Harness-launch failures inside `startHarness()` already use — instead of leaving the app in a state with no window and no diagnostic.

**Drain both `ExecToStack` return values.** `installer.nsh`'s poll loop now pops the return code into `$1` and the output text into `$2`, matching the documented two-value contract, before the existing `StrCmp $1 1 …` decision.

## Alternatives considered

**Pre-seed `profiles/web/package.json` from the desktop shell before the Harness child's first boot.** Duplicates `PROFILE_TEMPLATES.web`'s ownership of profile initialization in a second place that can drift from it; the existence check is one line and needs no duplicated template. Rejected.

**Wrap only the `disableMarketPlugins` call site in a `try`/`catch` instead of a terminal `.catch()` on the whole `whenReady` chain.** Fixes the one reproduced failure but leaves every other exception between `ensureDesktopPaths` and `startHarness()` (a permissions error, a `setupAutoUpdater` throw) still an unhandled rejection with no window. The terminal catch covers the whole pre-Harness startup sequence for the same one-line cost. Kept the local existence check too, since returning `[]` for "nothing to quarantine" is more precise than surfacing a failed-shell page for the expected fresh-install case.

## Consequences

`disableMarketPlugins` now lives in `src/main/market-plugins.ts` with its own `tests/market-plugins.spec.ts` (fresh-manifest no-op, filtered removal, in-box preservation, backup-before-rewrite, no-op leaves the file untouched); `index.ts` itself still has no direct test coverage; behavior reached only through `app.whenReady()` needs an Electron-level harness to test, out of scope here. A startup failure before `startHarness()` now reaches the same recovery page as a launch failure, without a "Disable Market Plugins" button (that action needs a `code`/`message` this early path does not have). The NSIS stack fix has no local check — `makensis` compiles a leaked stack either way — so its evidence is the corrected `Pop` pairing matching the documented `nsExec::ExecToStack` contract, not a test.
