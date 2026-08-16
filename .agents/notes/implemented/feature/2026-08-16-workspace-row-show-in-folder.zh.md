# Agent Note: 工作区行 — 在操作系统文件管理器中显示

Status: implemented

[English](2026-08-16-workspace-row-show-in-folder.md) | 中文

## Problem

侧边栏的工作区行此前只有 重命名/删除。管理多个工作区的用户想进入目录本身——打开 agent 以未上报名字生成的文件、往里放素材——只能悬停等 hover 卡片、复制路径、再手动粘进文件管理器。缺少 Codex 式的“直达工作区”。

## Decision

**复用现有 `host.openPath` 通道，在行菜单里加一项。** 对目录而言，openPath 各平台的打开器（`open`／`Invoke-Item`／`xdg-open`）本来就会在文件管理器中打开该目录，因此不需要新的 wire 面——工作区菜单新增 在文件夹中显示 / Show in folder（`menu.showInFolder`，`IconFolderOpen16`），通过新的 `openWorkspacePath` 注入动作携带该组的 `cwd`。该菜单项仅当页面为 loopback 且当前 Host 描述报告 `canOpenPath` 时存在——与产出文件行相同的双事实门控，远程页面的渲染与之前完全一致。ui-workspace 插件的 inject 名册新增 `connection`，其浏览器 inject 面新增 `isLoopback`、`openWorkspacePath` 与 `hostDescription` 源（组件侧绑定为 `useHostDescription`）。

## Alternatives considered

**在其父目录中 reveal 该工作区目录**（`host.revealPath`，见 [reveal note](2026-08-16-host-reveal-path.md)）。此入口不采用：工作区手势要的是打开目录本身，而不是打开父目录并选中它——openPath 才是正确的动词，reveal 保持文件级语义。

**放在 hover 卡片里而不是菜单行。** hover 卡片本就能展示并复制完整路径，但可发现性正是被报告的痛点；⋯ 菜单是行级动词的居所（重命名/删除），入口应在其中。

## Consequences

未分组桶没有背后的目录，保持无菜单行。fixture 的 Host 描述早已宣告 `canOpenPath: true`，因此无密钥浏览器车道能覆盖该入口；工作区菜单的 aria golden 新增一行，已随本改动一并刷新。桌面壳无需任何改动：它的 Harness 子进程即 loopback，门控天然通过。
