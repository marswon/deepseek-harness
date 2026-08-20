# Agent Note：桌面端更新安装交接由应用自己接管

Status: implemented

[English](2026-08-16-desktop-update-install-handoff.md) | 中文

## 问题

Windows 更新反复把用户卡在 NSIS 的“无法关闭”弹窗上。electron-updater 的 `quitAndInstall` 让安装器启动和应用退出竞争；死在弹窗上的安装器会持有按应用的互斥锁，之后的尝试会重新弹出旧提示。此前的 NSIS 自定义 hook 按镜像名结束进程，但没有在替换前确认文件句柄已消失。macOS 上 Squirrel.Mac 会拒绝 ad-hoc 签名包的原地更新，因为 designated requirement 含逐二进制 cdhash；未经公证的替换 dmg 也会让 Gatekeeper 再次要求用户打开应用。

dshmarket 需要 Corepack 和 pnpm，但打包运行时只有 Node 解释器。它的重启动作还会创建一个不受 Electron 管理的 `dsh web` 进程，而窗口仍连接在旧端口。

## 决策

**安装交接由应用自己接管，electron-updater 只负责检查和下载。** 该模式参照 anywhere-labs/deepseek-harness-desktop 的自托管更新器，但保留我们的 GitHub Releases feed 和差量下载。

- Windows：从 `app-update.yml` 的 `updaterCacheDirName` 解析 pending 安装器路径，先强杀该目录中遗留的安装器，再启动 detached PowerShell 等待器。等待器只在 Electron PID 消失后才带 `--updated --force-run` 运行 NSIS；pending 路径无法解析时回退到 `quitAndInstall`。
- NSIS：`build/installer.nsh` 替换原生运行进程弹窗，强杀后在替换文件前进行有界轮询。
- macOS：把 dmg 下载到 `userData/updates/<版本>`，打开它并给出拖拽替换的指引。当前发布渠道没有 Apple Developer 凭据，带 tag 的构建保持 ad-hoc 签名，替换后会触发 Gatekeeper 提示。
- [内嵌 Node 运行时](2026-08-14-desktop-bundled-node-runtime.md)携带 Corepack 和 npm。桌面 overlay 会关闭 dshmarket 不受管理的重启，Harness 重启由 Electron 菜单接管。

## 否决的方案

**保留 quitAndInstall、只加快应用退出。** rc.15 停掉 Harness 子进程后已经退得很快，更新依然失败；僵尸互斥锁问题不在应用的退出路径上。否决。

**在有 Developer ID 凭据前阻止所有发布。** 这会在无法创建 Apple 身份的同时扣留可用的 Windows 和 Linux 修复。当前发布渠道发布已记录 Gatekeeper 限制的 ad-hoc 签名 macOS 产物；未来可信渠道仍需要公证。否决。

**更新时先卸载再安装。** oneClick NSIS 安装器在安装时本来就会先跑旧卸载器；卡点是进程检查和互斥锁，不是文件替换。否决，因为打错了层。

## 影响

macOS 用户通过打开的 dmg 拖拽替换来更新；重启即更新只存在于 Windows。自定义 NSIS 检查会强杀运行中的应用镜像，并等待最多五秒使其消失。下载的 dmg 累积在 `userData/updates/` 下（每个版本一个，暂无清理）。完整 Node 发行版会增加打包体积，但插件安装可自包含。行为覆盖：`apps/desktop/tests/updater.spec.ts`（等待器调度、僵尸安装器清扫、回退、dmg 下载与打开）、`runtime.spec.ts`（启动与 overlay 参数）及 `paths.spec.ts`（桌面 dshmarket overlay）。
