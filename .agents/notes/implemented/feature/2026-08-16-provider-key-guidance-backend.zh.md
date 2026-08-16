# Agent Note: 提供方密钥指引后端 —— consoleUrl 与密钥校验

Status: implemented

[English](2026-08-16-provider-key-guidance-backend.md) | 中文

## Problem

Models 设置页此前能列出可配置提供方、能询问起草中的端点（见[端点询问笔记](../architecture/2026-08-04-draft-provider-endpoint-interrogation.md)），但两个 Cherry Studio 式指引手势没有后端答案。其一，“这个提供方的密钥去哪获取？”：目录条目只给出提供方名称和 settings 地址，没有官方控制台页面，获取密钥链接只能让 UI 硬编码 URL。其二，“这条密钥能用吗？”：对 catalog 路由，`discoverModels` 直接由适配器注册表作答、完全不联网——这是“有哪些模型？”的正确答案，却对“这条密钥被接受吗？”毫无用处。

## Decision

**`consoleUrl` 搭载可配置提供方目录。** `LlmConfigurableProvider` 新增可选 `consoleUrl`——提供方获取或购买 API 密钥的官方页面——原样穿过 `ConfigurableProviderView`（`consoleUrl?: string`，schema 中为 `z.url().optional()`）与 `llm.providers` 映射；映射在缺失时省略该字段而非发出显式 undefined。缺失表示“不知去向”，界面只在适配器指明目的地时提供链接。`dsh-llm-deepseek` 为 `deepseek-official` 声明 `https://platform.deepseek.com/api_keys`。`dsh-llm-pi-ai` 新增两张以 catalog 提供方 id 为键的模块私有表——`PROVIDER_CONSOLE_URLS` 与 `PROVIDER_DISPLAY_NAMES`，每条都与已安装 catalog 自己的 base URL 核对过——由 `directoryEntries()` 解析两者：profile 配置的 `displayName` 优先；表中有名字的提供方得到漂亮拼写（`OpenAI`、`xAI`……）而非原始路由键；不在表中的提供方保留路由键且不带 `consoleUrl`。等于路由键的 profile `displayName` 是解析出的默认值而非用户选择，因此存储任何 profile 不再把已入表提供方的条目降回原始键。

**`validate: true` 把询问变成检查密钥动作。** `LlmModelDiscoveryRequest` 新增可选 `validate` 标志——只接受以给定密钥认证的实时网络往返作答——与其余草稿字段一样穿过 wire schema 和 `llm.discoverModels` 映射，并被 `llm` 接缝原样传递：接缝只负责路由草稿，只有适配器决定该标志改变什么。在 `dsh-llm-pi-ai` 中，`validate` 跳过 catalog 捷径；被校验的 catalog 路由在草稿未给端点时回退到该 catalog 提供方自己的 base URL——被检查的密钥本就属于那个端点——而 catalog 未记录端点的提供方则被告知去设置 `baseURL`，而不是被“ships no catalog”这样的假话敷衍。错误分类不变；响应保持已发现模型的答案形态。

**`dsh-llm-deepseek` 现在为自己的 namespace 提供发现。** 插件注册 `registerModelDiscovery('llm-deepseek', …)`：点名 `deepseek-official` 的请求由已配置 catalog 作答、不联网——与 pi-ai 对其 catalog 路由的姿态相同——而 `validate: true`（或点名其他路由的草稿）询问 `GET {baseURL}/models`，OpenAI 兼容、bearer 认证，`baseURL` 回退到已配置端点。表单输入的 `apiKey` 优先于已存凭据，后者只在网上路径经插件自己的按请求解析器解析，且当任何地方都没有密钥时以 `MISSING_CREDENTIAL` 失败。该模块镜像 pi-ai 的发现实现——相同的按实际读取字节执行的四兆字节上限、相同的中止纪律、相同的带 401/403“check the API key”后缀的 `DISCOVERY_FAILED` 分类——采用复制而非共享，因为 pi-ai 的发现模块是包内私有的，为共享管道而扩大其公共 API 是更坏的交易；这处刻意镜像带有 `jscpd:ignore` 标记并注明缘由。

## Alternatives considered

**在 UI 里放控制台 URL 表。** 否决：UI 将持有与后端已交付 catalog 漂移的 提供方 id → URL 映射，而自建网关条目根本没有官方页面——只有适配器知道它是否存在。把该事实放在目录条目上，也让现在与未来的每个配置界面都能用到。

**单独的 `llm.validateKey` RPC。** 否决：它将复制整条发现管道（端点解析、凭据优先级、错误分类）却只返回更差的答案——一个布尔值——而检查成功时返回的已发现模型列表正是表单下一步想要的候选清单。

**在 `validate` 下从 catalog 推导 wire 协议。** 被校验的 anthropic 路由会落到 `openai-completions` 默认值，并把端点的 401 报成“check the API key”，存在误报可能。作为范围取舍否决：检查密钥动作面向指引流程所服务的 OpenAI 兼容提供方，诚实的修法属于协议感知的探测，而不是在此处开个特例。

**经 `dsh-llm` 共享发现管道。** 两个消费方是抽取开始划算的门槛，但这些助手是询问内部件——字节上限读取与列表解析——眼下没有第三个消费方，且本仓库孪生适配器的惯例本来就是平行实现优于共享抽象。

## Consequences

配置 wire 现在能用固定字段名回答两个指引手势，供 UI 直接编程对接：`llm.providers` 行上的 `consoleUrl` 与 `llm.discoverModels` 上的 `validate`。已入表的 pi-ai 提供方在目录出现的各处都显示漂亮名称，这是新字段之外可见的行为变化。复制而非共享的选择代价是一个镜像模块，已用 `jscpd` 标记围起；若第三个适配器家族日后也需要端点询问，届时应把管道移到 `dsh-llm`。

## Testing

`packages/llm/llm/tests/topology.spec.ts` 钉住 `consoleUrl` 的目录往返与 `validate` 到适配器的透传。`packages/llm/llm-pi-ai/tests/{catalog,dynamic-config,discovery}.spec.ts` 钉住表查询（全部十一个条目、未入表的回退、profile `displayName` 优先级）与 `validate` 行为（catalog 路由被强制联网、false 或缺省时保留注册表捷径、catalog 端点回退、records-no-endpoint 拒绝）。`packages/llm/llm-deepseek/tests/discovery.spec.ts` 用本地 HTTP 服务器驱动新处理器：catalog 作答、携带已存与输入密钥的 validate 往返、已配置端点回退、200/401/403/500 矩阵、非列表与非 JSON 响应体、两种形态的字节上限、缺失与畸形凭据、调用方取消。`packages/host/apiproxy/tests/{api-proxy-config,client-handler}.spec.ts` 覆盖 wire：映射对 `consoleUrl` 的包含与省略、`validate` 完整穿过载体、缺失字段保持缺失。
