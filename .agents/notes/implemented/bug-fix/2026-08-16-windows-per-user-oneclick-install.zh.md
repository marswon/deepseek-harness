# Agent Note: Windows 改为当前用户一键安装——更新永远不需要管理员权限

Status: implemented

[English](2026-08-16-windows-per-user-oneclick-install.md) | 中文

## Problem

进程门禁修完之后，Windows 更新仍然弹“无法关闭 DeepSeek Harness”——而此时应用确实已关闭、安装目录下没有任何进程。这句文案被包解压的重试循环复用（`extractAppPackage.nsh`）：真正的失败是无管理员权限的安装包往 `C:\Program Files\DeepSeek Harness` 里 `CopyFiles` 失败。用户当初通过 assisted 安装器的“为所有用户安装”把应用装进了 Program Files，而 electron-updater 能省则省地以非提权方式启动更新安装包——因此在这类安装上，每次更新无论进程状态如何都注定失败。

## Decision

**仅当前用户 + 一键安装。** `nsis.oneClick: true` 加 `perMachine: false`：安装落在 `%LOCALAPPDATA%\Programs`，永远不需要 UAC，更新在构造上零弹窗（oneClick 安装器还会安静地强关运行中的应用）。assisted 安装器的目录选择页随之消失，整个 per-machine 失败模式一并离场。

## Alternatives considered

**保留 assisted 安装器并在更新时提权。** electron-updater 只在自家启发式判断需要时才提权，而 assisted 流程在 `--updated` 场景的重提权是生态里出了名的不稳路径；per-user 是直接消除需求，而不是修补检测。

**参照 dataelement/dsh-desktop。** 它根本没有做自动更新（“not yet integrated”），Windows 端也从未真机验证过，无可借鉴；我们这条链（退出次序、运行时暂存、进程门禁、per-user 安装）才是更完整的答案。

## Consequences

既有的 Program Files 安装需要手动卸载一次——那个卸载器带着 taskkill 宏，不会再弹窗；从 Program Files 卸载出现 UAC 提示属正常。oneClick 安装器会发现旧的 per-machine 注册并安静调用其卸载器；有残留也可在 设置→应用 里删除。portable 产物不受影响。新流程的验证与这一系列改动一样，最终落在真实 Windows 机器上。
