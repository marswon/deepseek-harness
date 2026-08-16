# Agent Note: NSIS 安装包的进程检查不得依赖注册表推导

Status: implemented

[English](2026-08-16-nsis-custom-check-app-running.md) | 中文

## Problem

即使在 Harness 子进程先于安装包退出、运行时迁出安装目录之后，Windows 更新仍然循环报“无法关闭 DeepSeek Harness”。现场取证显示：弹窗挂着的时候，stock 宏的进程探针（把 `Win32_Process` 的路径与 `$INSTDIR` 做前缀匹配）实际回答是 NOT-FOUND，而上一次安装的卸载注册表项的 `InstallLocation` **是空的**。`$INSTDIR` 被推导成空串后，`StartsWith('')` 对所有有路径的进程都成立：安装包眼里整台机器都在“运行”，它的 Stop-Process 扫荡随后打到无关进程，无论如何重试都不可能通过。

## Decision

**用 `apps/desktop/build/installer.nsh` 里的 `customCheckAppRunning` 覆盖进程门禁**（electron-builder 默认拾取该 include 路径）。宏不再读注册表、不做前缀匹配：应用本来就会在安装包启动前自行退出（见退出次序 note），而自从运行时暂存 note 之后安装目录只承载 Electron 主程序，因此宏只按精确映像名强杀 `${APP_EXECUTABLE_FILENAME}`——`taskkill` 不依赖 WMI，进程不存在时无害通过，且全程不弹窗。该宏同时管辖 assisted 安装器与卸载器。

## Alternatives considered

**修复注册表项／在上游更防御地推导 INSTDIR。** 空的 `InstallLocation` 只是一台机器上的一条坏记录，而 stock 设计——从注册表推导再做全进程前缀匹配——对下一种边角情况依旧脆弱；覆盖宏直接消除整类问题，而不是修补单个实例。

**全新安装时保留 stock 的提示。** stock 宏提示后照样强杀；跳过提示只是少了一步可能误报的环节。应用自身的退出路径已经给了用户保存状态的机会。

## Consequences

更新与卸载都不会再出现“无法关闭”：最坏情况是 800ms 的延迟和一次空转的 taskkill。这是 Windows 更新三部曲的第三层也是最后一层（退出次序、运行时暂存、进程门禁）——每层单独成立，合起来让安装包没有任何东西可查。该改动在打包时编入安装器；行为验证只能在真实 Windows 机器上进行。
