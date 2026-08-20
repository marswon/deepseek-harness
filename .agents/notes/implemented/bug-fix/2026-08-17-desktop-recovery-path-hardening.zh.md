# Agent Note：加固桌面端恢复路径自身的故障模式

Status: implemented

[English](2026-08-17-desktop-recovery-path-hardening.md) | 中文

## 问题

Windows 市场插件隔离与崩溃恢复动作（构建在[把 dshmarket 打进 web profile](../feature/2026-08-16-bundle-dshmarket-into-web-profile.md) 之上）读取 `profiles/web/package.json` 时既没有存在性检查，调用它的 `app.whenReady()` 链上也没有 `.catch()`。全新安装从未运行过 Harness 子进程，`PROFILE_TEMPLATES.web` 还没有把该文件生成出来（`packages/boot/app-boot/src/profile.ts` 的 `loadProfile`/`initProfile` 只在子进程内运行）；对它 `readFile` 会抛 `ENOENT`，而 `index.ts` 里这条 rejection 之上没有任何东西能接住。Electron 会把 `whenReady` 延续中的未捕获 rejection 变成静默卡死：没有窗口、没有日志行、没有恢复页——每个全新 Windows 安装的用户在见到应用之前就会撞上，这严格地比恢复路径本要处理的原生崩溃更糟。

另外，`build/installer.nsh` 的进程退出轮询调用了 `nsExec::ExecToStack`，却只 `Pop` 了返回码。`ExecToStack` 会先压返回码、再压捕获到的输出文本；把第二个值留在共享的 NSIS 变量栈上、循环最多 20 次，会让同一次安装run中之后每一个无条件 `Pop` 错位（包括 electron-builder 自带模板代码），这是一条潜在的安装器损坏路径，且本地没有任何检查能发现它——`makensis` 与 `--config.win.signAndEditExecutable=false` 交叉构建两种情况都能干净编译通过。

## 决策

**把缺失的 profile 清单视为"没有可隔离的东西"，并给 `whenReady` 一个终结性 catch。** `disableMarketPlugins`（抽取到 `src/main/market-plugins.ts`，可脱离 Electron 做单元测试）现在在读取清单前经 `existsSync` 返回 `[]`。`index.ts` 中的 `app.whenReady().then(...)` 链新增 `.catch()`，记录失败并渲染既有的失败 shell 页面——也就是 `startHarness()` 内部运行时解析与 Harness 启动失败已经在用的同一个页面——而不是把应用留在没有窗口、没有诊断的状态。

**把 `ExecToStack` 的两个返回值都取走。** `installer.nsh` 的轮询循环现在把返回码弹入 `$1`、输出文本弹入 `$2`，符合文档规定的双值约定，之后才走既有的 `StrCmp $1 1 …` 判断。

## 否决的方案

**在 Harness 子进程首次启动前，由桌面壳预先生成 `profiles/web/package.json`。** 这会把 `PROFILE_TEMPLATES.web` 对 profile 初始化的所有权复制到第二处、并可能与其漂移；存在性检查只有一行，且不需要复制模板。否决。

**只用 `try`/`catch` 包住 `disableMarketPlugins` 调用点，而不给整条 `whenReady` 链加终结性 `.catch()`。** 这能修掉已复现的那一个故障，但 `ensureDesktopPaths` 到 `startHarness()` 之间的其它任何异常（权限错误、`setupAutoUpdater` 抛错）仍是没有窗口的未捕获 rejection。终结性 catch 以同样的一行代价覆盖整段 Harness 启动前序列。局部存在性检查也保留了，因为对预期中的全新安装场景，返回 `[]` 表示"没有可隔离的东西"比抛出失败页面更精确。

## 影响

`disableMarketPlugins` 现在位于 `src/main/market-plugins.ts`，并有自己的 `tests/market-plugins.spec.ts`（全新清单为空操作、按过滤移除、保留内置 bundle、改写前备份、空操作不动文件）；`index.ts` 自身仍无直接测试覆盖；只能经 `app.whenReady()` 到达的行为需要 Electron 级别的测试脚手架，不在本次范围内。`startHarness()` 之前的启动失败现在会到达与启动失败相同的恢复页面，但没有"Disable Market Plugins"按钮（该动作需要这条早期路径拿不到的 `code`/`message`）。NSIS 栈修复没有本地检查——`makensis` 对泄漏的栈两种情况都能编译通过——所以它的证据是修正后的 `Pop` 配对符合文档中 `nsExec::ExecToStack` 的约定，而不是某个测试。
