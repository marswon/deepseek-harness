# DeepSeek Harness Desktop

English | [中文](README.zh.md)

<img src="apps/desktop/build/icon.png" width="96" alt="DeepSeek Harness icon">

**DeepSeek Harness Desktop** is the desktop app for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), the open-source agent harness from DeepSeek AI. One installer gives you the full agent workspace — no Node.js, no terminal setup.

## Download

Get the latest build from [Releases](https://github.com/marswon/deepseek-harness/releases/latest):

| Platform | File | Notes |
|---|---|---|
| macOS (Apple Silicon) | `DeepSeek-Harness-*-arm64.dmg` | Not signed yet — right-click → **Open** on first launch |
| Windows 10/11 (installer) | `DeepSeek-Harness-Setup-*.exe` | Per-user install, no administrator rights needed |
| Windows 10/11 (portable) | `DeepSeek-Harness-*.exe` | Single file, run from anywhere |

After install, the app downloads updates in the background and applies them on restart.

## Screenshots

![First-run setup wizard](assets/screenshot-onboarding.png)

![Main window](assets/screenshot-main.png)

![Model provider settings](assets/screenshot-models.png)

## Features

- **Ready out of the box** — the runtime and web UI ship inside the installer; install and start a session, nothing else to set up.
- **Guided first run** — a setup wizard walks you through getting a DeepSeek API key, pasting it in, and verifying it before your first session.
- **Plugin marketplace** — browse and install community plugins from **Settings → Plugin Market**, powered by [dshmarket](https://github.com/dsh-market/dsh-market).
- **Workspace at hand** — jump straight to a workspace folder, or reveal any file the agent generated in Finder/Explorer directly from the session.
- **File attachments** — attach code and text files inline, or drop in PDF, Word, Excel, and PowerPoint documents; the app extracts their text locally before sending.
- **Automatic updates** — new versions download in the background and install on restart.

## Security notes

- macOS builds are not yet signed with an Apple Developer certificate, so Gatekeeper warns on first launch; right-click the app and choose **Open**.
- Windows builds install per user and never ask for administrator rights.
- Marketplace plugins are third-party code running with the agent's permissions; install only plugins you trust.

## Relationship to upstream

This repository forks [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) and adds the desktop shell (`apps/desktop`), the onboarding wizard, and the bundled plugin market. The harness core tracks upstream. See [docs/architecture.md](docs/architecture.md) for the architecture and [AGENTS.md](AGENTS.md) for contributor guidance.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md). For agents, follow [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
