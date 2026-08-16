# Agent Note: host.revealPath — 在操作系统文件管理器中显示路径

Status: implemented

[English](2026-08-16-host-reveal-path.md) | 中文

## Problem

对话界面此前可以打开产出文件或工具参数中的文件（`host.openPath`，见[文件打开 note](2026-07-28-tool-call-file-open-in-os.md)），也可以从产出文件行打开 workspace 文件夹，但无法在宿主的文件管理器中选中某个文件——也就是用户在路径旁边期待的“它到底落在哪儿”手势。用默认应用打开所在目录并不等价：在 macOS 与 Windows 上，文件管理器有专门的“选中并显示”调用方式。

## Decision

**一条端到端镜像 `host.openPath` 的特权一元 RPC。** `host.revealPath({ path })` 与 openPath 共享传输层形态（`{ opened: true }`）、成对的 zod schema、fetch 载体中的注册行、`dsh-client-connection` 特权集合中的仅环回固定，以及网关中 `openTarget` 的失败映射（调用方中止为 `cancelled`，其余为 `internal`）。`host.describe` 在 `canOpenPath` 旁新增 `canRevealPath`；两者都是关于桌面可达性的平台事实，因此网关唯一的 `nativeOpen`／`canOpenPath` 覆盖项同时约束两者，而注入的 `defaults.revealPath` 按定义即为可 reveal。

**平台映射作为第三个 `PathOpenIntent` 落在 `native-path-opener.ts`。** reveal 在 macOS 上分发为 `open -R`，在 Windows 上为 `explorer.exe /select,<path>`；Explorer 即使成功选中也会以退出码 1 退出，因此仅容忍这个数值码，其余拒绝（包括字符串形式的 spawn 失败码）一律上抛。WSL 先经 `wslpath -w` 转换再交给同一个 Explorer 调用——转换步骤现在与 open 路径共用。桌面 Linux 没有标准的 reveal 手势，因此对其所在目录调用 `xdg-open`。浏览器文档快速路径对 reveal 永不适用：reveal 是文件管理器手势，而非内容展示。`canRevealNativePath` 逐字复用 `canOpenNativePath` 的答案。

**客户端只穿一条可选回调。** `WorkspacesService.revealPath` 镜像 `openPath`；chat 视图的 inject 面新增 `revealFile`，仅当页面使用 loopback 且当前 Host 描述报告 `canRevealPath` 时存在（回调缺省即不渲染该入口，与 `TurnTailOwnerProps` 消费方的关闭态写法一致）。回调沿 `ChatViewInjected` → `ChatNodeOwnerProps` → `ToolCallOwnerProps` → 三个文件路径行（FileMutationRow、ReadRow、GenericToolCard）→ `ToolRow.onRevealFile` 传递，后者在现有打开链接旁渲染一个文件夹图标（`IconFolderOpen16`，文案 `reveal.inFolder` = 在文件夹中显示）；路径链接本身保持打开行为，错误行的失败首行两种手势都不携带。产出文件行的**在文件夹中显示**操作此前只在有溢出时出现，现在只要该轮产出了文件且 Host 能打开路径即渲染——它仍经由同一属主 `openFile('.')` 路径 reveal workspace。

## Alternatives considered

**在 `host.openPath` 上加 `select: true` 标志。** 一个方法两种手势——之所以否决，是因为传输层词表与能力宣告作为孪生方法更干净：`canOpenPath` 与 `canRevealPath` 回答的是不同问题，且每个现存 openPath 调用点的语义完全不变。

**在 describe 载荷里只复用 `canOpenPath`。** 之所以诱人，是因为今天两个平台答案相同；之所以否决，是为了让未来某个 reveal 手势不同的平台（例如拥有真正“在管理器中选中” D-Bus 路径的 Linux 桌面）可以在不改协议的前提下分叉。共享同一个覆盖旋钮正是对这种对称性的刻意让步。

**按 ui-deliverables 的 connection inject 模式在 ToolRow 内部做门控。** ToolRow 是纯展示组件，所在包不持有 connection 面；门控属于提供回调的属主，这与 `inspect` 的到达方式一致。组件侧门控还会把 loopback 规则分散到两个包里。

## Consequences

远程（非环回）页面与 headless Host 渲染的行与之前完全一致——图标根本不出现。fixture 传输层把 reveal 应答为确定性的空操作成功，与 openPath 相同，因此无密钥 lane 可以驱动该手势。Windows 用户会看到 reveal 成功，尽管 Explorer 报告退出码 1；这一怪癖已在适配器与包 README 中注明。桌面 Linux 的 reveal 会打开所在目录但不选中文件——这是平台的上限，现在被写明而非掩盖。
