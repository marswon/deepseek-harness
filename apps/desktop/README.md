# @deepseek-ai/dsh-desktop

English | [中文](README.zh.md)

Desktop shell for DeepSeek Harness: an Electron main process that supervises a local `dsh web` child process and loads its UI in a hardened window. It consumes the workspace sources directly — no patches, no pinned npm release — so the desktop app tracks the repository version.

## Runtime architecture

```
Electron main (apps/desktop)
├── userData/                     desktop-owned data root (survives upgrades)
│   ├── harness/                  $DSH_HOME: profiles, sessions, settings, credentials
│   ├── runtimes/<version>-<platform>-<arch>/  staged dsh-runtime copy (kept out of the install dir)
│   ├── launch-root/              default project directory (no startup prompt)
│   └── logs/harness.log          child stdout/stderr
├── Harness child process         bundled stock Node running `dsh web --host 127.0.0.1 --port 0`
│   └── ready line on stdout →    `dsh web: http://127.0.0.1:<port>`
└── BrowserWindow                 contextIsolation + sandbox, loopback-only navigation
     └── http://127.0.0.1:<port>  Harness web UI
```

- Development spawns the system Node against the repository build (`apps/cli/lib/bin.js`); packaged builds stage the bundled runtime closure and the complete target-platform Node.js distribution (Node, npm, npx, and Corepack) into the desktop data root (`runtimes/<version>-<platform>-<arch>`) on first launch and run the copy from there. The copy earns its completion marker only after its Node passes a `node --version` probe — a foreign-architecture or corrupt staged copy is re-copied once and then rejected loud instead of bricking every launch. The install directory never hosts a running process, which keeps Windows updates from locking it; Corepack supplies the profile's pnpm command for plugin-market installs without requiring a system Node install. Both modes pass `--expose-internals` so the Cordis loader never needs the native `node-addon-require-builtin` fallback. The Electron binary is not reused as Node: Electron's V8 sandbox makes N-API raw-memory views fatal (`koffi.view` in the win32 dialog worker).
- node-pty ships N-API prebuilds, which are ABI-stable across Node 22/24; no native rebuild is needed at packaging time (`npmRebuild: false`).
- Only loopback HTTP and local shell pages may load in the window; other http(s) targets open in the system browser. The renderer never gets Node access.
- The web profile ships [dshmarket](https://github.com/dsh-market/dsh-market) (Settings → 插件市场): the community plugin marketplace from the awesome-dsh-plugin registry — one-click install/update/remove, no CLI. Plugins are third-party code; the market only installs sources on the awesome list and never runs their build scripts by default.

## Commands

```sh
pnpm run build                                        # repo root first: lib/ + apps/web/dist
pnpm --filter @deepseek-ai/dsh-desktop run dev        # build the shell and open it
pnpm --filter @deepseek-ai/dsh-desktop run stage      # materialize the production runtime closure
pnpm --filter @deepseek-ai/dsh-desktop run package:mac:arm64   # plus :mac:x64 / :win / :linux:x64 / :linux:arm64
pnpm --filter @deepseek-ai/dsh-desktop run package:win:cross   # unsigned Win x64 build from a non-Windows host
```

Packaging requires a host matching the target platform/arch (`scripts/verify-target.mjs` enforces it) because node-pty prebuilds and the landlock launcher ship per platform. macOS artifacts in the current release channel are ad-hoc signed and not notarized because no Apple Developer credentials are configured; Gatekeeper prompts after install or replacement. `package:win:cross` is the deliberate exception: it stages the win32/x64 binary packages fetched from the registry (`stage:win`) and builds an unsigned NSIS/Portable artifact from any host with `signAndEditExecutable=false` (rcedit needs wine off Windows); `scripts/after-pack.cjs` then embeds `build/icon.ico` and the product version into the exe with resedit, so the installed app no longer shows the stock Electron icon and metadata.

Release tags must be `v`-prefixed semver (`v0.1.0-rc.34`), not namespaced tags like `dsh-desktop-v*`: electron-updater's GitHub provider validates every tag in the releases feed with `semver.valid` and silently reports "No published versions on GitHub" when none parse. Pushing such a tag runs the release matrix and publishes its artifacts. electron-updater only checks versions and downloads; the install handoff is app-owned: on Windows the shell force-stops stale pending installers, then starts a detached PowerShell waiter which runs the NSIS installer only after Electron exits; `build/installer.nsh` also waits for Electron child processes to disappear before replacing files. On macOS the app downloads the dmg into `userData/updates/<version>` and opens it for manual drag-replace; because the artifacts are only ad-hoc signed, Gatekeeper prompts again for the replacement. On Linux electron-updater's own AppImage/deb install runs unchanged; the shell only stops the Harness child first, and a deb update raises a pkexec/sudo password prompt.

## Linux

**The deb is the primary format.** Ubuntu 24.04 and later set `kernel.apparmor_restrict_unprivileged_userns=1`, which stops Electron's sandbox from opening a user namespace. Only a package with a maintainer script can install the AppArmor profile that grants it back, so the deb's `after-install` hook writes `/etc/apparmor.d/DeepSeek-Harness` (skipped automatically on releases whose AppArmor predates `abi/4.0`, such as 22.04). An AppImage runs no install script and therefore cannot ship that profile: electron-builder's launcher probes `unshare -Ur` and falls back to `--no-sandbox`, so it starts but runs its renderer unsandboxed. Prefer the deb wherever the choice exists.

Both formats build for x64 and arm64. Two arm64-specific caveats: the AppImage FUSE2 toolset ships runtime libraries for x64/ia32 only, so an arm64 AppImage needs `libfuse2` present on the host, and CI builds arm64 on `ubuntu-24.04-arm` rather than cross-compiling — glibc is backward but not forward compatible, so building on 24.04 keeps the artifacts runnable on 26.04.

Wayland: Electron 37 still defaults `--ozone-platform` to `x11`, so the shell passes `--ozone-platform-hint=auto` to run natively under a Wayland session (`src/main/linux-display.ts`) — Electron 38 makes that the default. An explicit `--ozone-platform`/`--ozone-platform-hint` argument or `ELECTRON_OZONE_PLATFORM_HINT` always wins, so a compositor-specific workaround is never overridden.

## Layout

```
src/main/     Electron main process: harness lifecycle, window, menu, updates, shell page, Linux display hint
src/preload/  sandboxed-renderer bridge (shell-page actions only)
scripts/      runtime staging, target verification, and the afterPack runtime copy
tests/        vitest specs for the electron-free logic plus a built-runtime boot smoke
electron-builder.yml
```

## Failure recovery

Startup watches for the child's ready line (two-minute timeout). A child that exits early, goes silent, or dies mid-session leaves the window on a shell page with the error, the log tail, and Retry / View Logs / Quit actions; the same actions live in the Harness menu along with Restart Harness.
