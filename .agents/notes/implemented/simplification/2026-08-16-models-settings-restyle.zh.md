# Agent Note: 模型设置页重排样式

Status: implemented

[English](2026-08-16-models-settings-restyle.md) | 中文

## Problem

设置 → 模型 页此前混用手搓胶囊按钮与裸原生控件：获取可用模型对话框里是未加样式的 checkbox 列表，模型目录行是 6px 内边距的四列挤压网格加两个 auto 图标列，自定义设置折叠面用 CSS 三角手绘 chevron。整页看起来比周围的设置外壳粗糙，且自绘按钮的几何已与原语漂移。

## Decision

**所有控件走原语，文案与流程不动。** 按钮全部换成 ui-primitives `Button`（outline/ghost/primary，密集处用 sm），只保留两个局部颜色覆写（`.dangerButton`、`.linkButton`）与 44px 虚线添加卡的 scoped 覆写；文本框全部换成 ui-primitives `Input`，免费获得品牌色聚焦边与占位符 token。由于 `Button` 本身不带焦点环，本模块补了作用域化的 `:focus-visible` 规则（section、两个对话框、summary、图标按钮），并用作用域 `box-sizing: border-box` 修正 outline 比 primary 高 2px 的错位。模型条目行获得呼吸感（padding 6→8、圆角 8→10、固定 28px 图标列、容量区上方 hairline），两个编辑器共用同一对 14px chevron/垃圾桶原语并包在 `aria-hidden` span 里。获取可用模型对话框的候选列表改为 token 化的行：带边框的滚动容器、hover 填充、`:has(:checked)` 选中填充、14px `accent-color` checkbox、`:focus-within` 整行焦点环。`<details>` 的 chevron 换成 `IconChevronDownOutline14` 加旋转过渡（reduced-motion 下关闭）。单一CSS文件从 675 行降到约 560 行——重复的按钮几何随之离场。

## Alternatives considered

**直接给 `Button` 原语补焦点环。** 长期正确归宿，但其他消费方目前各自打补丁；在本改动里动原语会把爆炸半径扩到从未触碰的页面。作用域规则让这次重排保持局部；原语级修复已记录为后续项。

**顺手改文案。** 拒绝：e2e 车道用 aria golden 钉住中文字符串，视觉打磨不应惊动文案评审。

## Consequences

行为与文案零变化：每个可见字符串逐字节不变。仅一个 aria golden（`models-settings/declared-edit`）因添加模型按钮多了图标 `img` 节点而需刷新——已在 diff 评审后随本改动更新。样式 token 守卫依旧通过，所有颜色/阴影都经 `--dsw-alias-*` 解析。本包 217 条 spec 未动且保持全绿——这正是目标：呈现层移动，行为不动。
