# Agent Note: Provider key guidance UI — check button, console links, first-run wizard

Status: implemented

English | [中文](2026-08-16-provider-key-guidance-ui.zh.md)

## Problem

The backend gained the two guidance facts ([the backend note](2026-08-16-provider-key-guidance-backend.md)): `consoleUrl` on the configurable-provider directory, and `validate: true` on `llm.discoverModels` turning interrogation into a live check-key round-trip. The UI had no surface for either: a user pasting a key into the provider editor learned whether it worked only by saving it and watching a session fail, and a first-run user met a bare credential form with no explanation of what an API key is or where to get one.

## Decision

**One shared check path, two call sites.** `KeyCheck.tsx` (ui-settings-models) carries the whole gesture: `useKeyCheck(api)` holds the component-local `idle | checking | ok(count) | failed(message)` state and runs the `llm.discoverModels({ …probe, validate: true })` call; `KeyCheckButton` is the ghost sm capsule beside the key input; `KeyCheckStatus` renders the verdict; `keyCheckFailureText` maps the host's fixed message vocabulary — "answered 401"/"answered 403" → 密钥无效或已过期，请检查后重新粘贴， "could not reach" → 无法连接到服务商，请检查网络或 API 地址， anything else raw. Both the `ProviderEditor` key row and the wizard's configure step compose these same three pieces, so a key is judged one way everywhere. A new keystroke in the key input resets the verdict — it belongs to the key it probed.

**The guidance line follows `consoleUrl`.** `KeyGuidance` renders nothing when the directory entry names no console page, the fuller what-is-a-key blurb plus 「前往 DeepSeek 开放平台获取」 for `deepseek-official`, and 「前往 {displayName} 控制台获取 API Key」 for any other provider with a known console. The page threads `consoleUrl` from `row.entry` through `EditorTarget` into every editor host (row editor, first-run setup card, add card). The link is a plain `<a target="_blank" rel="noreferrer">` — the first external link in settings UI; the Electron shell already routes http(s) navigation to the system browser, and a plain browser opens a tab.

**The first-run dialog is an in-component three-step state machine.** The slot framework is untouched: step id `deepseek-official`, `complete()` semantics, and the readiness projection (`onboardingReadiness` still recognizes only the official DeepSeek row) are unchanged. Inside `OnboardingModal` chrome the dialog walks 了解 (what a key is, where to get one, console link) → 配置 (key input + the shared check, 完成 disabled until the provider accepts the key, 跳过 keeps the old configure-later semantics of a bare `complete()`) → 完成 (deepseek-v4-flash default copy, 开始使用 stores the key). The finish write is exactly the credential half of the editor's credentialOnly save — `credentials.set` under `refFor(namespace, settingsPath, provider)`, now exported — with no settings op, and completion rides the refreshed join flipping readiness to provider-ready rather than a direct `complete()`, so the write and the ownership transfer cannot disagree. A 「使用其他提供方」 link on every step runs `openSection('models')` + `complete()`.

## Alternatives considered

**Keeping the embedded credentialOnly ProviderEditor as the wizard's only step.** Rejected: the guidance goal is pedagogical — a user who does not know what an API key is cannot use the form — and a single card cannot pace explanation, verification, and confirmation. The editor stays one code path by donating its check and its save half to the wizard rather than being embedded whole.

**A slot-framework multi-step flow (one registrant per wizard step).** Rejected: the steps share private draft state (the key, its verdict) that would have to cross registration boundaries, and the wizard is one onboarding obligation, not three. In-component state keeps the framework contract exactly as it was.

**Gating 完成 on a non-empty key instead of a successful check.** Rejected: a format-legal but wrong key then ends onboarding with a broken configuration, recreating the save-and-watch-it-fail loop the feature exists to remove. 跳过 remains the escape for a user who cannot or will not check.

## Consequences

`llm.discoverModels` with `validate: true` is now reachable from two UI gestures; the typed key still travels one-shot and is never stored by the probe. The provider editor's key row gained a button and up to three lines beneath it (format fault, verdict, guidance), so the Models settings page and the onboarding modal change visibly — the web goldens that capture them need a refresh. `DeepSeekOnboardingDialog.tsx` remains in the vitest coverage debt list (pre-existing entry), though the rewritten wizard spec covers every step transition, the check gating, and the save failure arms. The old `onboardingDescription` copy key is gone; `onboardingLater`/`onboardingSave`/`onboardingSaving` remain as the credentialOnly editor's label vocabulary.
