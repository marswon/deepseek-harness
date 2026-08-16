# Agent Note: Windows per-user one-click install — updates must never need admin

Status: implemented

English | [中文](2026-08-16-windows-per-user-oneclick-install.zh.md)

## Problem

After the process-gate fix, Windows updates still showed "DeepSeek Harness cannot be closed" — with the app verifiably closed and no process under the install directory. The dialog text is reused by the package-extraction retry loop (`extractAppPackage.nsh`): the real failure was `CopyFiles` into `C:\Program Files\DeepSeek Harness` from an installer running without admin rights. The user had installed per-machine through the assisted installer's "for all users" choice, and electron-updater launches the update installer unelevated whenever it can — so every update on such an install was doomed regardless of process state.

## Decision

**Per-user, one-click.** `nsis.oneClick: true` + `perMachine: false`: installs land in `%LOCALAPPDATA%\Programs`, need no UAC prompt ever, and updates become dialog-free by construction (the one-click installer also force-closes a running app quietly). The assisted installer's directory-choice page is gone, along with the whole per-machine failure mode.

## Alternatives considered

**Keep the assisted installer and elevate on update.** electron-updater only elevates when its own heuristic says so, and the assisted flow's re-elevation on `--updated` runs is a known-flaky path in the ecosystem; per-user removes the need rather than repairing the detection.

**dataelement/dsh-desktop as the reference.** It ships no auto-update at all ("not yet integrated") and has never verified Windows at runtime, so there was nothing to borrow; our chain (quit ordering, runtime staging, process gate, per-user install) is the fuller answer.

## Consequences

Existing per-machine installs (Program Files) must be uninstalled once by hand — that uninstaller carries the taskkill macro, so it no longer prompts; a UAC prompt on uninstall from Program Files is expected and normal. The one-click installer detects the old per-machine registration and its uninstaller quietly; any leftover can simply be removed via Settings → Apps. The portable target is unaffected. Verification of the new flow lands on a real Windows machine, as with the rest of this saga.
