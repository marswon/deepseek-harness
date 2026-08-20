# Agent Note：把精确配置监听限制在它自己的路径链上

Status: implemented

[English](2026-08-20-hmr-exact-config-watch-scope.md) | 中文

## 问题

`dsh web` 在 Linux 上启动失败，报 `ENOSPC: System limit for number of file watchers reached, watch '<userData>/harness/profiles/web'`，Harness 子进程以退出码 1 结束，桌面外壳拿到的 ready URL 背后没有任何服务。

`Hmr.registerConfig()` 监听的是一个精确的用户 patch 文件。该文件尚不存在时，`findWatchRoot` 向上走到最深的已存在祖先目录，并以剩余距离作为 `depth` 监听它——对 `profiles/web/desktop.patch.yml` 来说这个根就是 `profiles/web`，而它的同级条目包含该 profile 完整的已安装依赖树。chokidar 的 `depth` 限制的是递归下降的深度，但它仍会枚举每个访问到的目录，并为放行的每个条目注册一个原生监听，因此对 `profiles/web` 的 `depth: 0` 监听依然为该目录下每个顶层条目消耗一个 inotify 句柄，`node_modules` 也在其中。Linux 默认的 `fs.inotify.max_user_watches` 小到一个已填充的 web profile 就能在初始扫描期间把它耗尽。

这个故障并不专属于桌面外壳：任何 `$DSH_HOME/profiles/<name>` 下同时存在用户 patch 文件与已安装 bundle 树的 `dsh web` 运行都会撞上同一个上限。macOS 没有暴露它，因为其 FSEvents 后端不按路径消耗句柄。

## 决策

**只监听能通向目标文件的那条链。** `registerConfig()` 现在向 chokidar 传入由 `exactConfigIgnored(watchFilename, root)` 构造的 `ignored` 判定函数。该判定放行目标路径、目标与监听根之间的每个祖先目录，以及目标尚不存在的前缀（用户之后仍可能创建的目录），其余全部拒绝。`depth` 保持 `findWatchRoot` 计算出的值——它依然是正确的递归边界；真正把同级条目从扫描中移除的是这个判定函数。

**把监听成本变成可观测事实。** `Hmr.watchedConfigPaths(filename)` 报告一个注册当前持有的、已排序的绝对路径，于是真正要紧的不变式——句柄数在已安装依赖树旁保持有界——可以断言，而不是从「没有崩溃」间接推断。`packages/boot/app-boot/tests/hmr-config.spec.ts` 断言在预置了 `node_modules` 形状目录树的位置注册后只监听该链，并且目标文件的创建、修改与删除仍会触发刷新。

## 备选方案

**在 deb 维护脚本里提高 `fs.inotify.max_user_watches`。** 把系统级内核限额当成本应用可以花的额度，对 AppImage 与任何非 deb 安装都无效，需要 root，而且对 profile 增长到所选上限之外的用户仍会失败。它是受影响用户的正确即时解封手段，却是产品的错误修法。已否决。

**为精确配置监听切换 `usePolling: true`。** 消除句柄成本，但为一个只在人工编辑时才变化的文件，在每个会话、每个用户身上按间隔消耗定时器唤醒。已否决。

**监听最近的、非 profile 目录的已存在祖先，或对 `node_modules` 做特例。** 把某一种部署的目录命名编码进 vendored HMR，而且仍会枚举恰好位于目标旁边的其他内容。判定函数让监听范围精确等于注册所请求的范围，不需要知道邻居是什么。已否决。

**去掉父目录缺失的情形，要求 patch 文件在启动前已存在。** 该注册存在的意义恰恰是让之后添加的 patch 层无需重启即可生效，而 `registerConfig` 保留 `ignoreInitial: false` 以便注册时已存在的文件应用一次。已否决。

## 影响

精确配置注册现在只为自身路径链上的每个目录加上该文件各持有一个句柄，与 profile 安装了多少包无关。`watchedConfigPaths()` 是 vendored HMR 服务上新增的公开方法；它读取 chokidar 的 `getWatched()`，是该上界的断言面。本改动属于 vendored 本地修改，记为 `vendor/README.md` 第 19 条，任何一次从上游同步 HMR 之后都必须重新应用。

修复前的行为会被新测试拒绝：把 `ignored` 判定改回 `[]`，链范围用例即失败。已用 `packages/boot/app-boot/tests` 与 `packages/boot/cmdline/tests`（119 项测试）以及覆盖 `vendor/hmr` 与 `app-boot` 两个面的 `tsc -b` 验证。本地没有 Linux 运行复现原始 `ENOSPC`——句柄数上界替代了它，因为复现该崩溃需要耗尽真实的内核限额。
