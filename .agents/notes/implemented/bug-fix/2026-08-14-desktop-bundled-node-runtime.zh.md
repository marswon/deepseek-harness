# Agent Note: Desktop packaged builds run a bundled stock Node.js runtime

Status: implemented

[English](2026-08-14-desktop-bundled-node-runtime.md) | 中文

## Problem

桌面端首个构建（见 [Desktop shell as a supervised child-process wrapper](../architecture/2026-08-14-desktop-shell-child-process.md)）通过 `ELECTRON_RUN_AS_NODE=1` 复用 Electron 二进制作为 Harness 子进程的 Node。在真实 Windows 上，选择工作区时原生文件夹对话框 worker 崩溃：`FATAL ERROR: Error::New napi_get_last_error_info`，崩在 `readUtf16`（`packages/host/directory-picker-native/src/win32-dialog-bindings.ts` 里的 `koffi.view(address, …)`）。在 darwin 上用两行脚本即可复现：`koffi.address` + `koffi.view` 在 Electron-as-Node 下致命崩溃，在官方 Node 下正常。原因是 Electron 的 V8 sandbox 拒绝任意原生地址上的 N-API 裸内存视图，而官方 Node 的分配器接受。

## Decision

打包的桌面构建在内嵌的官方 Node.js 运行时上运行 Harness 子进程，按目标平台内嵌。`apps/desktop/scripts/stage-runtime.mjs` 钉住 `NODE_RUNTIME_VERSION`（22.21.1，满足仓库 engines `^22.19 || >=24`），下载官方 dist 归档（`NODE_DIST_MIRROR`，默认 npmmirror），只把解释器放在 `dsh-runtime/node-runtime/node`（win32 为 `node.exe`）；`runtime.ts` 的 packaged 模式改为 spawn 它，不再设置 `ELECTRON_RUN_AS_NODE`。开发模式（系统 Node 跑仓库构建）不变。

## Alternatives considered

- **改掉 `readUtf16` 对 `koffi.view` 的使用**（用 koffi out-param 读，而不是裸地址）。只修这一个崩溃点，但 Electron 与官方 Node 的行为差异对核心包里每一个现有和未来的裸内存 N-API 调用都仍是隐患，而我们不愿为一个壳层问题去搅动核心包。
- **在 win32 上钉死 browse 目录选择器**（home 级 patch 层）。交互降级，且 koffi 的 win32 JSONL 路径仍在同一运行时上——是规避而不是修复。
- **继续用 Electron-as-Node**（rc.5 的选择，当时以约 50 MB 体积为由否掉了内嵌 Node）。在此推翻：ABI 论证成立（N-API prebuild 确实能加载），但 V8 sandbox 的行为差异直到 win32 对话框 worker 在现场崩溃才暴露。

## Consequences

打包运行时在各平台上的行为与仓库自己的 Node 目标完全一致，整类 Electron-Node N-API 不兼容被消除，代价是每个平台约 40 MB 的额外下载量。`stage-runtime.mjs` 按打包目标（本机或交叉）抓取运行时，解释器缺失时载荷校验会让 staging 响亮相失败。staging 从此依赖 Node dist 镜像可达。
