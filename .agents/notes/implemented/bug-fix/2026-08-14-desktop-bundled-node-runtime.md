# Agent Note: Desktop packaged builds run a bundled stock Node.js runtime

Status: implemented

English | [中文](2026-08-14-desktop-bundled-node-runtime.zh.md)

## Problem

The first desktop build ([desktop shell as a supervised child-process wrapper](2026-08-14-desktop-shell-child-process.md)) ran the Harness child through `ELECTRON_RUN_AS_NODE=1`, reusing the Electron binary as Node. On real Windows, choosing a workspace crashed the native folder-dialog worker with `FATAL ERROR: Error::New napi_get_last_error_info` from `readUtf16` (`koffi.view(address, …)` in `packages/host/directory-picker-native/src/win32-dialog-bindings.ts`). Reproduced on darwin with a two-line script: `koffi.address` + `koffi.view` under Electron-as-Node fatals, and works under stock Node. Electron's V8 sandbox rejects N-API raw-memory views over arbitrary native addresses; stock Node's allocator accepts them.

## Decision

Packaged desktop builds run the Harness child under a stock Node.js runtime bundled per target platform. `apps/desktop/scripts/stage-runtime.mjs` pins `NODE_RUNTIME_VERSION` (22.21.1, satisfying the repo engines `^22.19 || >=24`), downloads the official dist archive (`NODE_DIST_MIRROR`, default npmmirror), and stages just the interpreter at `dsh-runtime/node-runtime/node` (`node.exe` on win32); `runtime.ts`'s packaged mode spawns it and no longer sets `ELECTRON_RUN_AS_NODE`. Development mode (system Node against the repo build) is unchanged.

## Alternatives considered

- **Patch `readUtf16` to avoid `koffi.view`** (read through a koffi out-param instead of a raw address). Fixes this one crash site, but the Electron-vs-stock-Node behavioral gap stays armed for every current and future raw-memory N-API call, in core packages we would rather not churn for a shell concern.
- **Pin the browse directory picker on win32** via the home-level patch layer. Degrades the interaction and leaves koffi's win32 JSONL path on the same runtime; a workaround, not a fix.
- **Keep Electron-as-Node** (the rc.5 choice, recorded as rejecting a bundled Node for its ~50 MB). Reversed here: the ABI argument held (N-API prebuilds load fine) but the V8-sandbox behavioral difference did not surface until the win32 dialog worker crashed in the field.

## Consequences

The packaged runtime behaves identically to the repository's own Node targets on every platform; the whole class of Electron-Node N-API incompatibilities is eliminated at ~40 MB of extra download per platform. `stage-runtime.mjs` fetches the runtime for the packaging target (host or cross), and the payload check fails the staging when the interpreter is missing. Staging now depends on the Node dist mirror being reachable.
