# Agent Note：桌面外壳支持 Linux，以 deb 为首选

Status: implemented

[English](2026-08-18-desktop-linux-release-target.md) | 中文

## 问题

`electron-builder.yml` 已声明 AppImage 与 deb 目标，`stage-runtime.mjs` 已处理 linux 的 Node 发行版，沙箱能力本就是 Linux-first（bwrap 然后 landlock-run，功能探测）。但没有任何流程发布它们，而未被测试覆盖的路径里藏着三个缺陷：

`setupAutoUpdater` 只对 `darwin` 分流，其余平台全部落进 Windows 路径。在 Linux 上这会走到 `pendingInstallerPath()`（从 `app-update.yml` 重建 `%LOCALAPPDATA%` 路径）和 `killStaleInstallers()`（spawn `powershell.exe`），在重建失败后又碰巧落到 `quitAndInstall()`，且全程输出 Windows 专属措辞的日志。重启更新恰好因这个巧合而可用，所以没有任何症状指向根因。

Linux 段没有 `artifactName`，因此 `productName: DeepSeek Harness` 会产出 `DeepSeek Harness-<版本>.AppImage`——正是 mac 段已经记录过的空格缺陷（GitHub 上传时把空格改写成点，而 `latest*.yml` 引用连字符形式，导致更新 404）。

Ubuntu 24.04 及以后默认设置 `kernel.apparmor_restrict_unprivileged_userns=1`，这会拒绝 Electron 沙箱创建 user namespace。Ubuntu 26.04 还移除了 Xorg 会话，而 Electron 37 的 `--ozone-platform` 仍默认为 `x11`，窗口会经 XWayland 渲染，分数缩放下发虚。

## 决策

**以 deb 作为 Linux 首选发布格式，AppImage 作为便利产物，两者都构建 x64 与 arm64。** 只有带 maintainer 脚本的包才能装上恢复沙箱所需的 AppArmor profile，因此 electron-builder 的 `after-install` 钩子写入 `/etc/apparmor.d/DeepSeek-Harness` 是决定性能力。AppImage 不运行安装脚本；electron-builder 的启动脚本会探测 `unshare -Ur true`，在 user namespace 不可用时加上 `--no-sandbox`，因此它能启动但 renderer 不在沙箱中。README 写明该取舍并引导用户使用 deb。

- `setupAutoUpdater` 新增显式 `linux` 分支（`setupLinuxUpdater`）。electron-updater 已根据 `resources/package-type` 选择 AppImageUpdater 或 DebUpdater，因此安装就是停掉 Harness 子进程后调用 `quitAndInstall()`——不涉及 pending 安装器路径，也不涉及 `powershell.exe`。重启对话框对 deb 说明 pkexec/sudo 提示，对 AppImage 则省略。被拒绝的检查（AppImage 未经自身 runtime 运行时 `isUpdaterActive()` 为 false，会 resolve null 且不发出任何事件）会报告更新不可用，而不是留下一个没反应的菜单项。
- Linux 获得无空格的 `artifactName`、显式 `maintainer`（fpm 拒绝只有名字的值）、`syncDesktopName: true` 加上 package.json 的 `desktopName`，使 `.desktop` 文件名、`StartupWMClass` 与 Electron 的 `app_id` 三者一致，从而让 GNOME 把窗口关联到其启动器图标；deb 依赖新增 `libgbm1` 以支持原生 Wayland。
- `ozonePlatformHint()`（`src/main/linux-display.ts`）在 Linux 返回 `'auto'`，其它平台返回 null，并让位于 `ELECTRON_OZONE_PLATFORM_HINT` 或显式的 `--ozone-platform*` 参数。`index.ts` 在模块作用域应用它，因为命令行开关只在应用 ready 之前生效。
- CI 在 `ubuntu-24.04` 上打包 `linux-x64`，在 `ubuntu-24.04-arm` 上打包 `linux-arm64`。

## 否决的方案

**只发 AppImage，因为单文件格式更通用。** 它无法安装 AppArmor profile，因此在 Ubuntu 24.04+ 上要么起不来，要么无沙箱运行。让更常见的 Ubuntu 配置成为受损的那一个，等于把优先级颠倒了；deb 能让 `sandbox: true` 保持有意义。作为首选方案否决，保留为面向非 deb 发行版的次要产物。

**彻底去掉 AppImage。** `--no-sandbox` 回退是 electron-builder 自身行为，且仍服务于没有 dpkg 的发行版。移除它会让这些用户无从安装。否决。

**在 x64 runner 上交叉编译 arm64。** `verify-target.mjs` 拒绝宿主与目标不一致，因为 node-pty prebuild 与 landlock 启动器按平台分发；`package:win:cross` 这个例外之所以存在，仅因为可以从 registry 抓到 win32 二进制。托管的 `ubuntu-24.04-arm` runner 让这个变通不再必要。否决。

**在 ubuntu-26.04 上构建以匹配目标。** glibc 向后兼容但不向前兼容，因此 26.04 的构建产物无法在 24.04 上运行，而 24.04 的产物两者皆可。26.04 的 runner 镜像目前也仍是 public preview。否决。

**把 `productName` 改名为 `DeepSeek-Harness`，从源头去掉空格。** `productName` 是全局的：它会重命名 macOS 的 `.app` 与 Windows 安装目录，使刚刚稳定下来的更新路径失效。Linux 局部的 `artifactName` 覆盖能达到相同的产物命名，且没有跨平台影响面。否决。

## 影响

Linux 发布携带四个产物，外加 blockmap 与 `latest-linux*.yml`。deb 保留 Electron 沙箱；AppImage 在 Ubuntu 24.04+ 上无沙箱运行，且 arm64 AppImage 还需要宿主具备 `libfuse2`，因为 FUSE2 工具集只提供 x64/ia32 的运行时库。传入 `--ozone-platform-hint=auto` 意味着比默认值生效早一个 Electron 版本进入原生 Wayland，因此合成器缺陷会先在这里暴露；环境变量与参数逃逸口正是为此保留。

行为覆盖：`apps/desktop/tests/updater.spec.ts`（Linux 交接给 electron-updater，且不触碰 pending 安装器路径与 `powershell.exe`；deb 与 AppImage 的对话框措辞差异；被拒绝的检查会报告而非静默）与 `tests/linux-display.spec.ts`（hint 只在 Linux 生效，且绝不覆盖显式选择）。未经验证：尚未执行任何 Linux 打包或安装——deb 的 AppArmor profile 安装、24.04+ 上 t64 依赖解析、26.04 桌面上 `bwrap` 的可用性，以及打包后的 Harness 子进程在内嵌 Node 下启动，都仍未在真机上验证。
