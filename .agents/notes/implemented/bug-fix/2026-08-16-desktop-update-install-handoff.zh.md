# Agent Note：桌面端更新安装交接由应用自己接管

Status: implemented

[English](2026-08-16-desktop-update-install-handoff.md) | 中文

## 问题

Windows 更新反复把用户卡在 NSIS 的"无法关闭"弹窗上，背后是三个叠加的原因。第一，electron-updater 的 `quitAndInstall` 同时做"启动安装器"和"退出应用"，与应用自身的退出流程一起和 NSIS 的运行进程检查形成竞态。第二——也是决定性的一条——死在该弹窗上的安装器会一直持有按应用的安装器互斥锁：之后每次更新尝试都会因 `ERROR_ALREADY_EXISTS` 直接中止，并把僵尸安装器自己的旧弹窗顶到前台，于是用户无论关掉什么都会看到同一个提示（一台受影响的机器上 `DeepSeek-Harness-Setup-0.1.0-rc.12.exe` 进程存活了数天）。第三，macOS 上 Squirrel.Mac 会对 ad-hoc 签名包强制签名校验一致性（其 designated requirement 是逐二进制的 cdhash），原地更新永远不可能成功——更新器下载了约 200 MB 后在校验阶段失败。

另外，dshmarket 安装插件时按名字 spawn `corepack`/`npm`，但打包后的 Harness 子进程 PATH 里没有内嵌 Node 的 bin 目录，导致安装以 `spawn corepack ENOENT` 失败，并回退到需要 sudo 的全局 npm 安装。

## 决策

**安装交接由应用自己接管，electron-updater 只负责检查和下载。** 该模式参照 anywhere-labs/deepseek-harness-desktop 的自托管更新器，但保留我们的 GitHub Releases feed 和差量下载。

- Windows：从 `app-update.yml` 的 `updaterCacheDirName` 加上 electron-updater 的 base-cache 规则拼出 pending 安装器路径，先强杀 pending 目录里仍在运行的进程（释放安装器互斥锁），再以 detached 方式带 `--updated --force-run` 启动安装器，spawn 成功后才退出应用。pending 路径无法解析时回退到 `quitAndInstall`。
- macOS：把 dmg 从 release 下载到 `userData/updates/<版本>`，打开它并给出拖拽替换的指引；下载失败则提供打开 release 页的选择。
- NSIS：`build/installer.nsh` 定义 `customCheckAppRunning`，把原生运行进程检查的重试弹窗替换为按镜像名强杀、不弹窗。
- 打包后子进程的 PATH 前插内嵌 `node-runtime` 的 bin 目录，插件可以按名字 spawn corepack/npm/npx。

## 否决的方案

**保留 quitAndInstall、只加快应用退出。** rc.15 停掉 Harness 子进程后已经退得很快，更新依然失败；僵尸互斥锁问题不在应用的退出路径上。否决。

**等 Apple Developer ID 签名来启用 Squirrel.Mac。** 签名是独立事项且没有排期；dmg 下载流程服务于未签名的现状，将来有了签名也不会因此出错。不作为前置阻塞。

**更新时先卸载再安装。** oneClick NSIS 安装器在安装时本来就会先跑旧卸载器；卡点是进程检查和互斥锁，不是文件替换。否决，因为打错了层。

## 影响

macOS 用户通过打开的 dmg 拖拽替换来更新；重启即更新只存在于 Windows。自定义 NSIS 检查在安装和卸载时会不询问地强杀任何运行中的应用实例。下载的 dmg 累积在 `userData/updates/` 下（每个版本一个，暂无清理）。行为覆盖：`apps/desktop/tests/updater.spec.ts`（spawn 顺序、僵尸安装器清扫、quitAndInstall 回退、dmg 下载与打开、失败回退）与 `runtime.spec.ts`（PATH 组成）。
