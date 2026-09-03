# Agent Note: Provider key guidance UI — 检查按钮、控制台链接与首启向导

Status: implemented

[English](2026-08-16-provider-key-guidance-ui.md) | 中文

## Problem

后端已经补上了两个指引事实（见[后端笔记](2026-08-16-provider-key-guidance-backend.zh.md)）：可配置提供方目录上的 `consoleUrl`，以及 `llm.discoverModels` 的 `validate: true`——把端点探测变成一次真实的密钥校验回环。但 UI 没有任何承载面：用户在提供方编辑器里粘贴密钥后，只能先保存、再看会话报错才知道密钥是否可用；首次启动的用户面对的则是一张光秃秃的凭证表单，既不知道 API Key 是什么，也不知道去哪里获取。

## Decision

**一条共享的检查路径，两个调用点。** `KeyCheck.tsx`（ui-settings-models）承载整个手势：`useKeyCheck(api)` 持有组件局部的 `idle | checking | ok(count) | failed(message)` 状态并发起 `llm.discoverModels({ …probe, validate: true })` 调用；`KeyCheckButton` 是密钥输入框旁的 ghost sm 胶囊按钮；`KeyCheckStatus` 渲染结论；`keyCheckFailureText` 映射宿主的固定消息词表——"answered 401"/"answered 403" → 密钥无效或已过期，请检查后重新粘贴，"could not reach" → 无法连接到服务商，请检查网络或 API 地址，其余原样展示。`ProviderEditor` 的密钥行与向导的配置步都组合这三件，因此密钥在任何地方都以同一方式被判定。密钥输入框里的每一次新击键都会重置结论——结论只属于它被检验时的那串密钥。

**指引行跟随 `consoleUrl`。** 目录条目没有命名控制台页面时 `KeyGuidance` 什么都不渲染；`deepseek-official` 渲染更完整的"什么是 API Key"说明加「前往 DeepSeek 开放平台获取」链接；其他已知控制台的提供方渲染「前往 {displayName} 控制台获取 API Key」。页面把 `consoleUrl` 从 `row.entry` 经 `EditorTarget` 穿进每一个编辑器宿主（行内编辑器、首启设置卡、添加卡）。链接是朴素的 `<a target="_blank" rel="noreferrer">`——设置 UI 里的第一个外链；Electron 壳已把 http(s) 导航路由到系统浏览器，普通浏览器则开新标签页。

**首启对话框是组件内部的三步状态机。** 槽位框架完全不动：步骤 id 仍为 `deepseek-official`，`complete()` 语义与就绪投影（`onboardingReadiness` 仍只识别 DeepSeek 官方行）都不变。在 `OnboardingModal` 外壳内，对话框依次走 了解（密钥是什么、去哪里获取、控制台链接）→ 配置（密钥输入 + 共享检查，校验通过前「完成」禁用，「跳过」保留原"稍后配置"的裸 `complete()` 语义）→ 完成（默认使用 deepseek-v4-flash 的说明文案，「开始使用」写入密钥）。完成时的写入与编辑器 credentialOnly 保存路径的凭证一半完全一致——在 `refFor(namespace, settingsPath, provider)`（现已导出）派生的引用下 `credentials.set`，不带任何设置写操作；完成动作由刷新后的 join 将就绪态翻为 provider-ready 来触发，而不是直接 `complete()`，因此写入与所有权转移不会互相矛盾。每一步底部的「使用其他提供方」链接执行 `openSection('models')` + `complete()`。

## Alternatives considered

**继续把内嵌的 credentialOnly ProviderEditor 当作向导唯一的一步。** 否决：指引的目标是解释——一个不知道 API Key 是什么的用户无法使用那张表单——而单张卡片无法铺开"解释、验证、确认"的节奏。编辑器通过把检查和保存的一半捐给向导来保持同一条代码路径，而不是被整体内嵌。

**用槽位框架做多步流程（每个向导步骤一个注册项）。** 否决：各步骤共享私有草稿状态（密钥、它的校验结论），这些状态将不得不跨越注册边界传递；而且向导是一项引导义务，不是三项。组件内部状态让框架契约保持原样。

**用"非空密钥"而不是"校验通过"来门控「完成」。** 否决：格式合法但错误的密钥会以一个坏配置结束引导，重新制造本特性要消除的"保存后看着它失败"循环。「跳过」仍留给无法或不愿校验的用户作为出口。

## Consequences

带 `validate: true` 的 `llm.discoverModels` 现在可从两个 UI 手势触达；键入的密钥依然一次性随请求传输，探测不会存储它。提供方编辑器的密钥行新增了一个按钮和下方至多三行（格式错误、校验结论、指引），因此模型设置页和引导弹窗都有可见变化——捕获了它们的 web 金样需要刷新。`DeepSeekOnboardingDialog.tsx` 仍在 vitest 覆盖率豁免清单中（既有条目），不过重写后的向导规格已覆盖每一步流转、检查门控和保存失败分支。旧的 `onboardingDescription` 文案键已删除；`onboardingLater`/`onboardingSave`/`onboardingSaving` 仍作为 credentialOnly 编辑器的标签词表保留。
