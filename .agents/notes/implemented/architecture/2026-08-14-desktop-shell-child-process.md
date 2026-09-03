# Agent Note: Desktop shell as a supervised child-process wrapper

Status: implemented

English | [中文](2026-08-14-desktop-shell-child-process.zh.md)

## Problem

DeepSeek Harness shipped a CLI and a browser UI but no desktop application. A desktop product needs zero-install distribution across macOS, Windows, and Linux, user data that survives upgrades, and failure recovery when the agent runtime cannot start — none of which a manually launched `dsh web` provides. The community wrapper dsh-desktop showed demand but pins an npm release and patches its `node_modules`, so every upstream release risks breaking it.

## Decision

`apps/desktop` (`@deepseek-ai/dsh-desktop`) is an Electron shell inside the monorepo, consuming workspace sources directly.

- The main process spawns `dsh web --host 127.0.0.1 --port 0` as a supervised child. Readiness is the stdout URL line the web bundle already prints after the plugin tree settles; startup fails loud after a two-minute timeout or an early exit, landing on a built-in shell page with the log tail and Retry / View Logs / Quit actions.
- `DSH_HOME` points at `<userData>/harness`, so profiles, sessions, settings, and credentials live outside the install directory and survive upgrades. The child's cwd is `<userData>/launch-root`, an app-owned directory, so the UI never opens with a directory prompt.
- Development spawns the system Node against the repository build; packaged builds spawn a stock Node.js runtime bundled per platform at `dsh-runtime/node-runtime` (the initial `ELECTRON_RUN_AS_NODE` choice was reversed — see [the bundled-Node bug-fix note](../bug-fix/2026-08-14-desktop-bundled-node-runtime.md)). Both pass `--expose-internals`, so the Cordis loader takes its preferred path and never loads the native `node-addon-require-builtin` fallback. node-pty ships N-API prebuilds, which are ABI-stable across Node 22/24, so packaging needs no native rebuild (`npmRebuild: false`).
- The BrowserWindow is hardened: `contextIsolation` + `sandbox`, no Node in the renderer, navigation restricted to the loopback Harness origin and local shell pages, other http(s) targets handed to the system browser.
- The production runtime closure is materialized by `apps/desktop/scripts/stage-runtime.mjs` through `pnpm deploy --legacy --prod` (the same route as `scripts/build-exe-for-python-sdk.ts`), with legacy-hoist restoration, symlink materialization, and a payload check that fails loudly when the build outputs are missing. Because the deploy runs with `auto-install-peers=false`, packages reachable only through peer declarations (`@deepseek-ai/cordis-plugin-group` and twenty-odd Service Definition peers) are restored by a manifest walk that copies whatever the repository install resolves and skips whatever it does not (optional provider SDKs, other-platform binaries, `@types/*`). The deploy invocation passes `--config.verify-deps-before-run=false`: without it pnpm's deps-status probe re-runs `install --production` at the workspace root and prunes development dependencies. electron-builder packs only the shell; `scripts/after-pack.cjs` copies the staged runtime into the bundle because the extraResources file matcher drops node_modules. Packaging runs per platform/arch (`verify-target.mjs` enforces host matches) because node-pty prebuilds and the landlock launcher are platform-specific.
- Updates use electron-updater against GitHub Releases; macOS notarization stays opt-in via CI credentials.
- The desktop shell is not an npm package: the dsh release family (`scripts/release/families.ts`) and the npm baseline (`scripts/publish-npm-baseline.ts`) name `apps/cli` and `apps/web` explicitly instead of globbing `apps/*`.

## Alternatives considered

- **Tauri with a Node sidecar.** Smaller installers, but the Harness runtime is a heavy Node plugin system (Cordis loader, pty, subprocesses, bundled Python runtime); squeezing it into a Rust-owned sidecar buys installer size at the cost of the riskiest part of the product. The repository's native-module and deploy tooling is all Node-shaped.
- **In-process host with an IPC fetch bridge**, as sketched in [GUI layering and RPC protocol](2026-07-19-gui-web-client-architecture.md): no HTTP server, smallest attack surface. It requires a new host composition without the webserver, an IPC transport under `packages/client/connection`, and a relative-base web build — roughly triple the work touching core client packages. The child-process route ships the same UI with zero changes to `packages/`; the IPC bridge remains a viable later evolution.
- **Fork or vendor dsh-desktop.** It is a thin patch-package wrapper around the pinned npm release; the monorepo integration replaces its entire patching mechanism with workspace sources, so borrowing its code buys little.
- **Ship a standalone Node binary in the bundle.** Rejected at the time for ~50 MB per platform of duplicated runtime, since N-API prebuilds made the ABI match look sufficient; [adopted later](../bug-fix/2026-08-14-desktop-bundled-node-runtime.md) when Electron's V8 sandbox proved fatal to koffi raw-memory views.

## Consequences

The desktop app tracks the repository version with no patch layer, and every platform gets the same shell. The cost: the packaged app carries a full production `node_modules` closure (hundreds of MB installed, comparable to any Electron app), Windows and Linux packaging paths are CI-verified but not yet runtime-verified on real hardware, and the shell page is the only desktop-specific UI — multi-window projects, tray-resident scheduled jobs, and a native approval center remain follow-ups.
