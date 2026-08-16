# Agent Note: 作曲器文件附件——回形针加入、文本文件草稿、提示词折叠

Status: implemented

[English](2026-08-16-composer-file-attachments.md) | 中文

## Problem

Web 作曲器此前只接受图片（粘贴与整页拖放，见[多模态图片输入 note](2026-07-22-web-multimodal-image-input-and-durable-attachments.md) 与[加入上限 note](2026-08-12-web-image-intake-and-limits-alignment.md)），其 README 还把前置加号按钮记录为"不是附件入口"。把源码或文本文件附进提示词——Codex 式的手势——在客户端完全没有路径。

## Decision

**三种手势共用一条加入漏斗。** 加号按钮旁的回形针按钮（`input.attach`，`IconPaperclipOutline16`）打开一个不设 `accept` 过滤的隐藏 `<input type="file" multiple>`——分类在代码中完成，被拒文件得到产品文案而不是选择器层面的静默过滤。该按钮、粘贴与 document 级拖放都进入 InputBar 的 `intakeFiles`：`image/*` 文件原样保持既有图片路径（`imageLimits` 预检、`createDraftImages`、预览 URL）；文本文件——`text/*` MIME 类型、允许列表扩展名、或知名 dotfile 名（`.gitignore`、`.env.example` 一类）——经新的异步 `addFiles` inject 回调进入 `ConversationController.createDraftFiles`，后者执行固定的 256KB 单文件上限、用 `file.text()` 读入全文，且只在全部读取成功后才登记草稿；其余一律以 `file.unsupportedType`（暂不支持该类型文件）宣告，完全不进入附件栏。超限与读取失败以类型化错误（`DraftFileTooLargeError`/`DraftFileReadError`）浮出，由 apply 层 inject 映射为 `file.tooLarge`/`file.readFailed` 文案——与 `UnsupportedImageMediaTypeError` 相同的边界本地化模式。

**一个草稿注册表，一个 id 槽位。** `ComposerAttachment` 改为联合类型：`{ kind: 'image', file, previewUrl }` 或 `{ kind: 'file', name, text }`。input machine 的 `imageIds` 槽位原样跟踪两种附件（machine、facade、hub 零改动）；ConversationController 的 `draftAttachments` map 仍是唯一内容存储，`releaseDraftImage` 只对图片种类吊销预览 URL。`AttachmentRail` 原子组件把没有 previewUrl 的条目渲染为随内容定宽的文件名 chip，带移除控件、无打开入口，因此图片与文件按草稿顺序混排。

**折叠而非新内容块。** `sendSession` 保持图片部分在前，并把每个文本文件折叠进唯一 text 部分、位于输入草稿之前——每文件 `文件 ${name} 的内容：\n\`\`\`\n${text}\n\`\`\`\n\n`，按草稿顺序——因此仅文件的发送就是文件块本身。文件内容由此作为普通提示词文本到达模型，由既有 prompt 事件捕获，无需新会话事件即满足"模型可见 ⟺ 已记录"规则。拖放遮罩文案（`image.dropTitle`/`dropDesc`）不再声称仅限图片；键保持不变。

**Office 文档本地解析，解析器绝不打进插件包。** 漏斗的分类顺序为图片 → 纯文本 → Office（`.pdf`/`.docx`/`.xlsx`/`.pptx`，按扩展名）→ 拒绝。`createDraftDocuments` 执行 10MB 单文件上限（`file.tooLarge` 文案改为按大小插值），在浏览器中提取文本——pdf.js 逐页文本、mammoth 的 Word 原文、Excel 每个工作表一节 CSV（`# Sheet: <name>`）、PowerPoint 每张幻灯片一节 DrawingML `a:t` 文本行（`# Slide N`）——按 200KB UTF-8 预算截断并在折叠块后附 `file.truncated` 注记；任何加载器、解析器或空内容失败都经 `DocumentParseError` 映射为 `file.parseFailed`（文档解析失败）。插件 client 包是内联全部依赖的单文件 CJS 产物，因此解析器（pdf.js、mammoth、SheetJS、JSZip，合计约 3MB）在首次使用时以**经典 script** 方式从应用的 `office-parsers/` 资产载入：apps/web 的 vite build 从本包的解析器依赖中原样产出这些文件，而经典 script 是唯一在桌面壳的 file:// dist 下同样可用的加载机制（那里无法对 URL 使用 ESM `import()`）。pdf.js 锁定在 v3（最后一个 UMD 构建；v4 起仅 ESM）；其 fake-worker 回退会在 Worker 构造失败时内联重载 worker 脚本，因此 worker 损坏只会降级为更慢的解析，绝不会破坏页面。解析期间附件栏旁显示待处理文件名 chip。

## Alternatives considered

**在 input machine 中另设 `fileIds` 槽位。** 命名更对称，但会搅动 machine、facade、hub 以及每条工作区切换的草稿携带路径，而行为毫无差别——machine 本就只把这些 id 当作不透明有序 token。`imageIds`/`addImages` 的过时命名改由 contract JSDoc 说明。

**像图片一样把文件上传为持久附件。** 图片越过宿主边界是因为模型按字节消费它们；文本文件的内容就是提示词文本，折叠让重放、分支与队列的文本预览机制在零宿主、零 wire 改动下继续工作。将来若出现模型可见的二进制文件需求，仍可再引入持久文件附件块。

**可配置的字节上限与扩展名列表。** 256KB 上限与允许列表是带有固定产品文案（「文件过大（最大 {size}）」）的产品常量，与图片加入的固定媒体类型列表一致；当前没有部署需要改变它们，因此未加 Config 字段。Office 上限（文件 10MB、提取文本 200KB）同理。

**内联解析器、仅延迟执行。** `tsdown` 的 `noExternal` 规则会把所有非平台依赖内联进单文件 CJS 插件包，因此"懒" `import()` 仍会让每次页面加载多背约 3MB 解析器代码——本特性的首屏预算排除了这条路。对服务化 URL 做运行时 ESM `import()` 也被否掉：桌面壳经 file:// 加载 dist，模块加载不可用，而经典 script 在包括 pdf.js fake-worker 路径在内的所有环境下都可用。

**用 pdf.js v5（当前版本）而非 v3。** v4 起仅提供 ESM 构建；script 标签加载器需要 UMD 全局（`window.pdfjsLib`），因此解析器锁定在 3.11.174——这里只做文本提取、无渲染面，旧引擎的渲染修复与本案无关。

## Consequences

此前得到图片格式拒绝文案的非图片非文本文件（如拖入的 PDF）一度改为"暂不支持该类型"宣告——一条加入公告改变了类别；随后一轮又为 PDF（及 Word/Excel/PowerPoint）提供了真正的路径。作曲器 DOM 新增一个按钮与一个隐藏 input，因此所有捕获工具行的浏览器快照 golden（约 40 个点名 "Commands" 按钮的 `*.expected.md` aria 快照）将在下一次 `DSH_SNAPSHOT=refresh` 时变动；Office 这一轮在此之外没有新增常驻 DOM。超过上限、无法读取或解析失败的文件在加入时即被拒并即时给出文案；宿主永远看不到它们。apps/web 的 dist 携带约 2.9MB 的 `office-parsers/` 资产，仅在首次附加 Office 文档时拉取。草稿文件文本只存在于内存：页面刷新即丢失未发送草稿，与图片草稿相同。pdf.js 停留在 v3，直到桌面壳获得可加载模块的服务协议，或作曲器改用宿主侧解析通道。
