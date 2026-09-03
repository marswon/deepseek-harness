# DeepSeek Harness 桌面版

[English](README.md) | 中文

<img src="apps/desktop/build/icon.png" width="96" alt="DeepSeek Harness 图标">

**DeepSeek Harness 桌面版**是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DeepSeek AI 开源的 Agent 运行时）的桌面应用。一个安装包即可拥有完整的 Agent 工作区——无需安装 Node.js，无需命令行配置。

它构建于**一切皆插件**的架构之上，由 [Cordis](https://github.com/cordiverse/cordis) 驱动，其设计参见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512)。

上游文档：[https://deepseek-harness.github.io/deepseek-harness/](https://deepseek-harness.github.io/deepseek-harness/)

## 下载

DeepSeek Harness 处于 _开发者预览_ 阶段，正在快速迭代。**未来将出现破坏兼容性的变更。**

运行本项目前，请阅读[安全说明](SAFETY.zh.md)。

从 [Releases](https://github.com/marswon/deepseek-harness/releases/latest) 获取最新版本：

| 平台 | 文件 | 说明 |
|---|---|---|
| macOS（Apple Silicon） | `DeepSeek-Harness-*-arm64.dmg` | 暂未签名——首次启动请右键 → **打开** |
| Windows 10/11（安装版） | `DeepSeek-Harness-Setup-*.exe` | 按用户安装，无需管理员权限 |
| Windows 10/11（便携版） | `DeepSeek-Harness-*.exe` | 单文件，即下即用 |
| Linux（Debian/Ubuntu） | `DeepSeek-Harness-*-amd64.deb`、`*-arm64.deb` | 推荐——在 Ubuntu 24.04+ 上唯一能保留沙箱的格式 |
| Linux（便携版） | `DeepSeek-Harness-*-x86_64.AppImage`、`*-arm64.AppImage` | 面向非 Debian 系发行版；在 Ubuntu 24.04+ 上无沙箱运行 |

Linux 上请优先选择 `.deb`：Ubuntu 24.04 及以后限制了非特权 user namespace，只有带安装脚本的包才能注册让应用保留沙箱所需的 AppArmor profile。用 `sudo dpkg -i DeepSeek-Harness-*.deb` 安装（若提示依赖缺失，再执行 `sudo apt-get -f install`）。AppImage 无法注册该 profile，因此启动时沙箱是关闭的；arm64 版 AppImage 还需要宿主已安装 `libfuse2`。

安装后应用会在后台自动下载更新，并在重启时完成升级。`.deb` 更新会要求输入密码，因为安装该包需要 root 权限。

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
- Linux `.deb` 包会安装 AppArmor profile，使 renderer 在 Ubuntu 24.04+ 上保持沙箱运行；AppImage 则是无沙箱运行。安装后可用 `aa-status | grep -i deepseek` 确认 profile 已生效。
- 插件市场中的插件是以 Agent 权限运行的第三方代码；请只安装你信任的插件。

## 与上游的关系

本仓库 fork 自 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)，在其之上增加了桌面外壳（`apps/desktop`）、首启向导与内置插件市场。Harness 核心持续跟踪上游。架构说明见 [docs/architecture.md](docs/architecture.zh.md)，贡献者指南见 [AGENTS.md](AGENTS.md)。

上游社区：通过 [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions) 提交反馈或 bug 报告；为你的插件仓库添加 [`dsh-plugin`](https://github.com/topics/dsh-plugin) 话题，便于被发现；欢迎加入 DeepSeek Harness 企微群：扫码添加企微小助手并填写入群问卷，完成后小助手会邀请你入群。

## 参与贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.zh.md)。

## 开发

请先阅读[开发指南](docs/development.zh.md)与[架构文档](docs/architecture.zh.md)。

面向 agent：请遵循 [AGENTS.md](AGENTS.md)。

## 许可证

[MIT](LICENSE)

第三方依赖及其许可证披露于 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
