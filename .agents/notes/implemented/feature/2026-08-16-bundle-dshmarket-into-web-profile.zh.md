# Agent Note: web profile 模板内置 dshmarket 插件市场

Status: implemented

[English](2026-08-16-bundle-dshmarket-into-web-profile.md) | 中文

## Problem

桌面用户不学会 `dsh plugin add` 命令行就无法发现和安装社区插件。而社区已经维护了恰好的成品：[dsh-market](https://github.com/dsh-market/dsh-market)——应用内插件市场（设置 → 插件市场），数据源是 awesome-dsh-plugin 注册表，一键安装/更新/卸载，并带安全闸门（只允许 awesome 收录来源、默认禁构建脚本、同源+环回校验）。把 awesome 列表静态拷进设置页等于重做一个更差且出厂即过期的版本。

## Decision

**把 dshmarket 作为模板组合包发行，而不是做成 UI 功能。** `PROFILE_TEMPLATES.web` 新增 `dshmarket`（`packages/boot/app-boot/src/profile.ts`），并由 `apps/cli` 依赖它，使双锚点组合包解析在任何安装内都能找到该包（包括桌面端暂存的运行时）。改动前初始化的既有 profile 不受影响：旧 web 元组进入 `INSTALLATION_OWNED_PROFILE_TUPLES`，`normalizeShippedProfile` 会在下次加载时恰好升级这些 manifest，用户自定义过的列表则原样保留。桌面壳和 Web UI 没有新增一行代码——市场本身是个插件，这正是架构的意图。

## Alternatives considered

**设置页里放策展静态列表。** 出厂即过期，且安装仍需要 dshmarket 已交付的全套机制（npm tarball 拉取、profile patch 写入、HMR）。两条轴上都严格更差，否决。

**桌面壳首启时往用户 `cordis.patch.yml` 注入市场条目。** 把产品内容写进用户拥有的文件，与 patch 语义相冲突；模板元组 + 安装自有规范化是为这种事设计的内置通道。

## Consequences

本 fork 的每次 `dsh web` 启动都会组合插件市场（包括 fork 的 CLI 用户，不止桌面端）。市场在浏览时才从 awesome-dsh-plugin.com 拉注册表，安装走 npm tarball——两者都只在用的时候需要网络，启动不需要。安装插件等于以用户权限运行第三方代码——适用市场自带的闸门，桌面版发布说明会携带该警告。供应链策略已把 `dshmarket@1.9.0` 记入 `minimumReleaseAgeExclude`（否则新发版本会被年龄门拦截）。
