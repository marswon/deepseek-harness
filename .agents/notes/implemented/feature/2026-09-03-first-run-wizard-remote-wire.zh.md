# Agent Note: Typert Remote 线上的首启向导与密钥检查

Status: implemented

[English](2026-09-03-first-run-wizard-remote-wire.md) | 中文

## 问题

[提供方密钥引导的后端](2026-08-16-provider-key-guidance-backend.zh.md)与 [UI](2026-08-16-provider-key-guidance-ui.zh.md) 两项决策当时面向已被删除的 `dsh-host-apiproxy` 传输设计：`ConfigurableProviderView`/`llm.providers` 携带 `consoleUrl`，`llm.discoverModels` 携带 `validate`。当前宿主改由 Typert Remote 暴露这两件事，因此设计需要一次重新落地——线路径、注入面与失败语义都要匹配 Remote 载体——而不重开已定案的设计。

## 决策

**线上字段只声明在源类型上，契约随之生成。** `LlmConfigurableProvider.consoleUrl` 与 `LlmModelDiscoveryRequest.validate` 只在 `dsh-llm` 的类型上声明一次，生成的 Typert 契约（`LlmRuntime` 上的 `@Remote listConfigurableProviders` 与 `@Remote('discoverModels')`）自动携带它们——不存在会漂移的手写线 schema。取消信号刻意不上线：`signal` 留在提供方侧的 `LlmModelDiscoveryOperation` 上，由 Remote 载体供给，因此线上词汇只携带草稿事实。接缝依然原样路由草稿；只有适配器读取 `validate`。

**客户端经页面的 operations 面到达探测。** `ui-settings-models` 的 `ModelsOperations.discoverModels(settingsNs, request)` 转发到 `ctx.remote.llm.discoverModels`；`useKeyCheck(operations)` 为 ProviderEditor 的「检查」按钮与向导的「配置」步共同组合它。载体把被拒绝或失败的探测回答为结果对象而非拒绝（rejection），因此 hook 与向导的保存路径都没有 catch——`failed(message)` 状态与第 3 步的错误行直接读取结果。

**向导本身是已定案的设计，保持不变。** 共享模态框内的组件内三步状态机，「完成」以一次成功探测为门禁，「跳过」保留稍后配置语义，凭据写入恰好是编辑器仅凭据保存的那一半（`refFor(...)` 之下），完成由刷新后的合并结果驱动。就绪投影、插槽注册（`deepseek-official`，order 0，在欢迎声明之后）与触发条件（空白 Hero 加 `credential-missing`）均未改动。对话框的 spec 覆盖使其条目得以从 `vitest.config.ts` 的 GUI 债务豁免清单中移除。

## 曾考虑的替代方案

**在 Remote 契约旁复活一份线 schema。** 否决：并行的 schema 是同一批字段的第二个真源；Typert 生成器已经把声明的类型投影到线上，codec 一并包含。

**保留对话框的覆盖率豁免。** 否决：重写后的向导 spec 覆盖每一次步进转换、检查门禁、保存失败分支与每种不可用/就绪变体，豁免的剩余理由只是惯性。

## 后果

浏览器的密钥检查现在走 `POST /api/llm/discoverModels`，携带具名线参数（`{ settingsNs, request }`，`validate` 在 `request` 内），回答是经严格校验的模型列表。e2e 通道正是在该 HTTP 路由上打桩以保持无密钥；其对话框快照期望捕获三步外观。fork 时期的笔记保留其决策；本笔记只拥有重新落地的事实。

## 测试

`packages/llm/llm/tests/topology.spec.ts` 钉住 `consoleUrl` 的目录往返与 `validate` 向适配器的透传。`packages/llm/llm-pi-ai/tests/{catalog,dynamic-config,discovery}.spec.ts` 钉住 console-url/显示名表与 `validate` 的捷径撤除、catalog 端点回退及 records-no-endpoint 拒绝。`packages/llm/llm-deepseek/tests/discovery.spec.ts` 用本地 HTTP 服务器驱动询问。`packages/client/ui-settings-models/tests/{key-check,onboarding-dialog}.client.spec.tsx` 覆盖共享检查与向导的每条路径。`apps/web/tests/onboarding-deepseek-config.e2e.ts` 在 `/api/llm/discoverModels` 路由打桩的情况下对真实宿主走完向导；`apps/web/tests/expected/` 下刷新后的快照钉住渲染出的各个步骤。
