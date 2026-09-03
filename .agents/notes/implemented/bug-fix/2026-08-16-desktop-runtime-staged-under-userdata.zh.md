# Agent Note: 打包运行时迁到 userData 下暂存，移出安装目录

Status: implemented

[English](2026-08-16-desktop-runtime-staged-under-userdata.md) | 中文

## Problem

Windows 会锁定每个运行中可执行文件及其已加载 DLL 所在的目录。桌面壳此前把受监督的 `dsh web` 子进程——内嵌的 `node.exe` 及整个 `dsh-runtime` N-API 树——从安装目录内启动，NSIS 更新器因此必须对一个满是活进程的目录做关闭并替换。实际使用中这既造成了“无法关闭”的重试死循环（见[退出次序 note](2026-08-16-desktop-update-stops-harness-first.zh.md)，它只修了次序），更严重的是还出过一次替换到一半的残缺安装，子进程随后每次启动都报 `ERR_MODULE_NOT_FOUND`，直到手动重装。

## Decision

**从桌面数据根目录下按版本暂存的副本运行运行时。** 首次启动（以及每次更新后，以 `app.getVersion()` 为键）时，`stagePackagedRuntime` 把 `resources/dsh-runtime` 复制到 `<userData>/runtimes/<version>-<platform>-<arch>`，子进程从副本启动；副本里的 Node 必须通过 `node --version` 探测才会写入完成标记（见[架构键暂存笔记](2026-08-21-desktop-runtime-arch-keyed-staging.zh.md)）。安装目录从此只承载 Electron 本体，NSIS 的关闭/强杀路径对它可靠；Harness 运行的任何内容都不可能再锁住安装器要替换的文件。暂存是崩溃安全的——副本先落在 `.staging-*` 兄弟目录，探测通过、写完完成标记后才改名就位，被杀掉的应用绝不会留下半截运行时；旧版本与残留暂存目录在成功暂存后清理。`resolveHarnessRuntime` 封装了这一步，开发模式原样透传。

## Alternatives considered

**更新时先卸载再安装。** NSIS 卸载程序跑的是同一个运行进程门禁（`CHECK_APP_RUNNING`），而失败模式是进程锁定 `$INSTDIR`，与安装次序无关——先卸载改变不了任何事。

**只修退出次序**（前一篇 note）。必要但不充分：即使退出握手完美，Harness 从运行时树里派生的任何孙进程（worker thread 在这里就是进程）都会比它活得久，重新锁住目录。

## Consequences

安装或更新后的首次启动多付一次运行时复制（SSD 上几秒，由现有 starting 页面承载）；之后的启动经标记直接复用暂存副本。磁盘代价是当前版本多一份运行时副本（旧版本会被清理）。`apps/desktop/tests/runtime.spec.ts` 用真实文件系统夹具固定了首次复制、复用、崩溃恢复与版本变更四条路径。`prepareForInstall` 的退出次序修复保留——子进程先死仍能让更新器的工作更短。
