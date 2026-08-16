# DeepSeek Harness 桌面版

[English](README.md) | 中文

<img src="apps/desktop/build/icon.png" width="96" alt="DeepSeek Harness 图标">

**DeepSeek Harness 桌面版**是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DeepSeek AI 开源的 Agent 运行时）的桌面应用。一个安装包即可拥有完整的 Agent 工作区——无需安装 Node.js，无需命令行配置。

## 下载

从 [Releases](https://github.com/marswon/deepseek-harness/releases/latest) 获取最新版本：

| 平台 | 文件 | 说明 |
|---|---|---|
| macOS（Apple Silicon） | `DeepSeek-Harness-*-arm64.dmg` | 暂未签名——首次启动请右键 → **打开** |
| Windows 10/11（安装版） | `DeepSeek-Harness-Setup-*.exe` | 按用户安装，无需管理员权限 |
| Windows 10/11（便携版） | `DeepSeek-Harness-*.exe` | 单文件，即下即用 |

安装后应用会在后台自动下载更新，并在重启时完成升级。

## 界面截图

![首次启动设置向导](assets/screenshot-onboarding.png)

![主窗口](assets/screenshot-main.png)

![模型提供方设置](assets/screenshot-models.png)

## 功能特性

- **开箱即用** —— 运行时与 Web 界面均已内置在安装包中；安装后即可开始会话，无需任何额外配置。
- **首启向导** —— 设置向导会引导你获取 DeepSeek API Key、粘贴并完成校验，通过后才进入首次会话。
- **插件市场** —— 在 **设置 → 插件市场** 中浏览并安装社区插件，由 [dshmarket](https://github.com/dsh-market/dsh-market) 提供支持。
- **工作区直达** —— 一键跳转到工作区文件夹，或直接在会话中把 Agent 生成的文件在 Finder/资源管理器中定位显示。
- **文件附件** —— 可内联附加代码与文本文件，也可直接拖入 PDF、Word、Excel、PowerPoint 文档；应用会在本地提取文本后再发送。
- **自动更新** —— 新版本在后台自动下载，重启后完成安装。

## 安全说明

- macOS 版本尚未使用 Apple 开发者证书签名，首次启动 Gatekeeper 会提示警告；请右键点击应用并选择**打开**。
- Windows 版本按用户安装，全程不需要管理员权限。
- 插件市场中的插件是以 Agent 权限运行的第三方代码；请只安装你信任的插件。

## 与上游的关系

本仓库 fork 自 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)，在其之上增加了桌面外壳（`apps/desktop`）、首启向导与内置插件市场。Harness 核心持续跟踪上游。架构说明见 [docs/architecture.md](docs/architecture.md)，贡献者指南见 [AGENTS.md](AGENTS.md)。

## 参与贡献

见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 开发

从 [开发指南](docs/development.md) 与 [架构文档](docs/architecture.md) 开始。对于 Agent，请遵循 [AGENTS.md](AGENTS.md)。

## 许可证

[MIT](LICENSE)

第三方依赖及其许可证披露于 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
