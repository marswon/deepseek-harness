# Agent Note: NSIS installer must not derive its process check from the registry

Status: implemented

English | [中文](2026-08-16-nsis-custom-check-app-running.zh.md)

## Problem

Even after the Harness child stopped before the installer ran and the runtime moved out of the install directory, Windows updates still looped on "DeepSeek Harness cannot be closed". Field forensics showed the process probe the stock macro runs — `Win32_Process` paths prefix-matched against `$INSTDIR` — answered NOT-FOUND while the dialog was up, and the previous install's uninstall registry entry had an **empty `InstallLocation`**. With `$INSTDIR` derived empty, `StartsWith('')` matches every process with a path: the installer saw the whole machine as "running", its Stop-Process sweep then hit unrelated processes, and no amount of retrying could ever pass.

## Decision

**Override the process gate with `customCheckAppRunning` in `apps/desktop/build/installer.nsh`** (electron-builder picks up that default include path). The macro no longer consults the registry or prefix-matches paths: the app already quits itself before the installer starts (the quit-ordering note), and since the runtime staging note the install directory hosts only the Electron exe, so the macro force-kills exactly `${APP_EXECUTABLE_FILENAME}` by image name — `taskkill` needs no WMI, treats "process not found" as harmless, and the macro never prompts. It governs the assisted installer and the uninstaller alike.

## Alternatives considered

**Repairing the registry entry / deriving INSTDIR more defensively upstream.** The empty `InstallLocation` is one bad entry on one machine, but the stock design — registry-derived prefix matching over every process — stays fragile for the next edge case; the override removes the entire class instead of patching one instance.

**Keeping the stock prompt for fresh installs.** The stock macro force-kills after the prompt anyway; skipping the prompt only removes a step that could misfire. The app's own quit path already gave the user the chance to save state.

## Consequences

Updates and uninstalls never show "cannot be closed" again: the worst case is a 800 ms delay and a no-op taskkill. This is the third and final layer of the Windows update saga (quit ordering, runtime staging, process gate) — each layer is independently justified, and together they leave the installer with nothing to check. The change compiles into the installer at package time; behavior verification is necessarily on a real Windows machine.
