# Agent Note: Desktop shell as a supervised child-process wrapper

Status: implemented

[English](2026-08-14-desktop-shell-child-process.md) | 中文

## Problem

DeepSeek Harness 此前只有 CLI 和浏览器 UI，没有桌面应用。桌面产品需要跨 macOS、Windows、Linux 的零安装分发、升级后仍保留的用户数据、以及 agent 运行时无法启动时的失败恢复——手动启动的 `dsh web` 一样都不提供。社区封装项目 dsh-desktop 证明了需求，但它钉住一个 npm 发布版并用补丁修改其 `node_modules`，上游每发一版都有失效风险。

## Decision

`apps/desktop`（`@deepseek-ai/dsh-desktop`）是 monorepo 内的 Electron 壳，直接消费 workspace 源码。

- 主进程以受监督的子进程方式拉起 `dsh web --host 127.0.0.1 --port 0`。就绪信号复用 web bundle 在插件树 settle 后打印的 stdout URL 行；两分钟超时或提前退出都会响亮相失败，落到内置 shell 页，展示日志尾部并提供 Retry / View Logs / Quit 三个动作。
- `DSH_HOME` 指向 `<userData>/harness`，profiles、sessions、settings、凭据都在安装目录之外，升级不丢数据。子进程 cwd 是应用自有的 `<userData>/launch-root`，UI 启动不再弹目录选择。
- 开发模式用系统 Node 跑仓库构建产物；打包产物 spawn 按平台内嵌在 `dsh-runtime/node-runtime` 的官方 Node.js 运行时（最初的 `ELECTRON_RUN_AS_NODE` 选择已被推翻——见[内嵌 Node 的 bug-fix 记录](../bug-fix/2026-08-14-desktop-bundled-node-runtime.zh.md)）。两者都传 `--expose-internals`，Cordis loader 走首选路径，不加载原生 `node-addon-require-builtin` 回退。node-pty 自带 N-API prebuild，ABI 在 Node 22/24 间稳定，打包无需原生重编（`npmRebuild: false`）。
- BrowserWindow 加固：`contextIsolation` + `sandbox`，renderer 无 Node 权限，导航只放行 loopback Harness 源与本地 shell 页，其余 http(s) 目标交给系统浏览器。
- 生产运行时闭包由 `apps/desktop/scripts/stage-runtime.mjs` 经 `pnpm deploy --legacy --prod` 物化（与 `scripts/build-exe-for-python-sdk.ts` 同一路线），含 legacy hoist 还原、符号链接实体化、以及构建产物缺失时响亮相失败的载荷校验。由于 deploy 以 `auto-install-peers=false` 运行，仅经 peer 声明可达的包（`@deepseek-ai/cordis-plugin-group` 等二十余个 Service Definition peer）由一次 manifest 遍历回补：仓库安装里能解析到的拷贝进来，解析不到的跳过（可选厂商 SDK、其他平台二进制、`@types/*`）。deploy 调用显式传 `--config.verify-deps-before-run=false`——否则 pnpm 的依赖状态探测会在 workspace 根重跑 `install --production`，剪掉开发依赖。electron-builder 只打包壳本身；staged 运行时由 `scripts/after-pack.cjs` 拷贝进 bundle，因为 extraResources 的文件匹配器会丢弃 node_modules。打包按平台/架构分别进行（`verify-target.mjs` 强制宿主匹配），因为 node-pty prebuild 与 landlock 启动器都是平台相关的。
- 自动更新走 electron-updater + GitHub Releases；macOS 公证默认关闭，由 CI 凭据开启。
- 桌面壳不是 npm 包：dsh 发布族（`scripts/release/families.ts`）与 npm 基线（`scripts/publish-npm-baseline.ts`）显式列出 `apps/cli` 与 `apps/web`，不再 glob `apps/*`。

## Alternatives considered

- **Tauri + Node sidecar。** 安装包更小，但 Harness 运行时是重型 Node 插件系统（Cordis loader、pty、子进程、内嵌 Python 运行时）；把它塞进 Rust 壳的 sidecar，省下的是体积，赌上的是产品里风险最高的部分。仓库的原生模块与部署工具链也都是 Node 形态的。
- **进程内 host + IPC fetch 桥**，即 [GUI layering and RPC protocol](2026-07-19-gui-layering-and-rpc-protocol.md) 的设想：无 HTTP server、攻击面最小。但它需要无 webserver 的新 host 组合、`packages/client/connection` 下的 IPC transport、相对路径的 web 构建——约三倍工作量且触及核心 client 包。子进程路线零改动 `packages/` 就能上线同一套 UI；IPC 桥仍是可行的后续演进。
- **fork 或 vendor dsh-desktop。** 它是围绕钉死 npm 版本的薄 patch-package 封装；monorepo 集成用 workspace 源码替代了它整套补丁机制，借它的代码收益有限。
- **安装包内附带独立 Node 二进制。** 当时以每个平台约 50 MB 的重复运行时为由否决——N-API prebuild 让 ABI 匹配看似充分；后来 Electron 的 V8 sandbox 被证明对 koffi 裸内存视图是致命的，于是[改为采用](../bug-fix/2026-08-14-desktop-bundled-node-runtime.zh.md)。

## Consequences

桌面端与仓库版本锁步，无补丁层，各平台共用同一个壳。代价是：打包产物携带完整生产 `node_modules` 闭包（安装体积数百 MB，与常见 Electron 应用相当）；Windows 与 Linux 的打包路径过了 CI 但尚未在真机上做运行时验证；shell 页是目前唯一的桌面特有 UI——多项目多窗口、托盘常驻定时任务、原生审核中心留作后续工作。
