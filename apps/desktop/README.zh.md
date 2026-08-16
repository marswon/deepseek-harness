# @deepseek-ai/dsh-desktop

[English](README.md) | 中文

DeepSeek Harness 桌面壳：Electron 主进程监督一个本地 `dsh web` 子进程，并在加固窗口中加载其 UI。它直接消费 workspace 源码——无补丁、不钉 npm 版本——因此桌面端与仓库版本锁步。

## 运行时架构

```
Electron main (apps/desktop)
├── userData/                     desktop-owned data root (survives upgrades)
│   ├── harness/                  $DSH_HOME: profiles, sessions, settings, credentials
│   ├── runtimes/<version>/       staged dsh-runtime copy (kept out of the install dir)
│   ├── launch-root/              default project directory (no startup prompt)
│   └── logs/harness.log          child stdout/stderr
├── Harness child process         bundled stock Node running `dsh web --host 127.0.0.1 --port 0`
│   └── ready line on stdout →    `dsh web: http://127.0.0.1:<port>`
└── BrowserWindow                 contextIsolation + sandbox, loopback-only navigation
     └── http://127.0.0.1:<port>  Harness web UI
```

- 开发模式用系统 Node 跑仓库构建产物（`apps/cli/lib/bin.js`）；打包产物首次启动时把运行时闭包和完整的目标平台 Node.js 发行版（Node、npm、npx、Corepack）复制到桌面数据根目录（`runtimes/<版本>`）并从副本启动。安装目录永远不会承载运行中的进程，Windows 更新不会被其锁住；Corepack 会提供 profile 的 pnpm 命令，插件市场不再依赖系统已安装 Node。两者都传 `--expose-internals`，Cordis loader 因此不需要原生 `node-addon-require-builtin` 回退。不复用 Electron 二进制当 Node：Electron 的 V8 sandbox 会让 N-API 裸内存视图致命崩溃（win32 对话框 worker 里的 `koffi.view`）。
- node-pty 自带 N-API prebuild，ABI 在 Node 22/24 间稳定，打包时无需原生重编（`npmRebuild: false`）。
- 窗口只放行 loopback HTTP 与本地 shell 页；其余 http(s) 目标交给系统浏览器。renderer 永远拿不到 Node 权限。
- web profile 自带 [dshmarket](https://github.com/dsh-market/dsh-market)（设置 → 插件市场）：来自 awesome-dsh-plugin 注册表的社区插件市场——一键安装/更新/卸载，无需命令行。插件是第三方代码；市场只安装 awesome 列表收录的来源，且默认不执行其构建脚本。

## 命令

```sh
pnpm run build                                        # repo root first: lib/ + apps/web/dist
pnpm --filter @deepseek-ai/dsh-desktop run dev        # build the shell and open it
pnpm --filter @deepseek-ai/dsh-desktop run stage      # materialize the production runtime closure
pnpm --filter @deepseek-ai/dsh-desktop run package:mac:arm64   # plus :mac:x64 / :win / :linux
pnpm --filter @deepseek-ai/dsh-desktop run package:win:cross   # unsigned Win x64 build from a non-Windows host
```

打包要求宿主平台/架构与目标一致（`scripts/verify-target.mjs` 强制），因为 node-pty prebuild 与 landlock 启动器按平台分发。本地 macOS 产物使用 ad-hoc 签名；带 `v` tag 的发布工作流会提供 Developer ID 证书并启用 Apple 公证。`package:win:cross` 是有意的例外：它用 `stage:win` 从 registry 抓取 win32/x64 平台二进制包，并以 `signAndEditExecutable=false` 在任意宿主上构建未签名的 NSIS/Portable 产物（rcedit 离开 Windows 需要 wine）；随后 `scripts/after-pack.cjs` 用 resedit 把 `build/icon.ico` 与产品版本写进 exe，安装后的应用不再显示 Electron 默认图标与元数据。

Release tag 必须是带 `v` 前缀的 semver（如 `v0.1.0-rc.18`），不能用 `dsh-desktop-v*` 这类带命名空间的 tag：electron-updater 的 GitHub provider 会用 `semver.valid` 校验 releases feed 里的每个 tag，全部不合法时只会静默报 "No published versions on GitHub"。推送该 tag 会运行发布矩阵并发布产物。electron-updater 只负责版本检查和下载，安装交接由应用自己接管：Windows 上外壳先强杀 pending 目录里的僵尸安装器，再启动一个 detached PowerShell 等待器，确认 Electron 退出后才运行 NSIS 安装器；`build/installer.nsh` 也会等待所有 Electron 子进程消失后再替换文件。macOS 上应用把 dmg 下载到 `userData/updates/<版本>` 并打开，由用户拖拽替换；发布产物使用 Developer ID 签名并经公证，因此替换后的应用继续得到 Gatekeeper 信任。

## 目录结构

```
src/main/     Electron main process: harness lifecycle, window, menu, updates, shell page
src/preload/  sandboxed-renderer bridge (shell-page actions only)
scripts/      runtime staging, target verification, and the afterPack runtime copy
tests/        vitest specs for the electron-free logic plus a built-runtime boot smoke
electron-builder.yml
```

## 失败恢复

启动监听子进程就绪行（两分钟超时）。子进程提前退出、静默超时或运行中崩溃时，窗口落到 shell 页，展示错误、日志尾部和 Retry / View Logs / Quit 三个动作；Harness 菜单里同样有这些动作和 Restart Harness。
