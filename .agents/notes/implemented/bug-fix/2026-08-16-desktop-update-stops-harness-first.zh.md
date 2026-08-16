# Agent Note: Windows 更新安装失败——Harness 子进程在退出后仍存活

Status: implemented

[English](2026-08-16-desktop-update-stops-harness-first.md) | 中文

## Problem

Windows 上在更新就绪对话框点 Restart 后，NSIS 安装包弹出“无法关闭 DeepSeek Harness”，重试也无法继续。根因是 electron-updater 的 `BaseUpdater.quitAndInstall` 的次序事实：它**先启动 NSIS 安装包，再退出应用**。桌面壳监督的 `dsh web` 子进程（安装目录 `resources/` 下内嵌的 `node.exe`）在安装包枚举被锁定文件时仍然存活，因此只要子进程比退出握手活得久，每次重试都会失败。

## Decision

**先停 Harness 子进程，再调 `quitAndInstall`。** `setupAutoUpdater` 新增 `prepareForInstall?: () => Promise<void>` 选项；Restart 对话框处理器先等待它（失败仅记日志，不阻断安装），然后才调用 `autoUpdater.quitAndInstall()`。壳入口传入的回调会置起 `quitting` 标志并等待 `harness.stop()`——这样安装包启动时已无任何进程持有安装目录下的文件，随后的 `before-quit` 因标志已置位而直接放行，不再在被阻止的退出窗口里重跑优雅停止。

## Alternatives considered

**让 NSIS 安装包自己关应用。** electron-builder 的安装包本就会尝试；但它不认识我们那个名字叫 `node.exe` 的子进程，而锁住文件的恰恰是它。关闭必须发生在我们的进程里、安装包启动之前。

**用足够快的 before-quit 与安装包赛跑。** 旧代码就是这么做的；只要优雅停止还在进行而安装包已经在跑，这在构造上就是一场竞态。

## Consequences

macOS 不受影响（未签名构建走手动下载的更新流程）。该行为由 `apps/desktop/tests/updater.spec.ts` 固定：mock 两个 electron 模块，跨 `process.platform` 桩驱动 win32/darwin 两个分支——包括次序断言（`prepare` 先于 `quitAndInstall`）与 prepare 失败路径。
