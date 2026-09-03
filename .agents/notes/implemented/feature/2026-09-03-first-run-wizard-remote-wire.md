# Agent Note: First-run wizard and key check on the Typert Remote wire

Status: implemented

English | [中文](2026-09-03-first-run-wizard-remote-wire.zh.md)

## Problem

The [provider key guidance backend](2026-08-16-provider-key-guidance-backend.md) and [UI](2026-08-16-provider-key-guidance-ui.md) decisions were designed against the deleted `dsh-host-apiproxy` transport: `ConfigurableProviderView`/`llm.providers` carried `consoleUrl`, and `llm.discoverModels` carried `validate`. The current host exposes both facts through Typert Remotes instead, so the design needed a re-landing whose wire path, injection face, and failure semantics match the Remote carrier — without reopening the settled design.

## Decision

**The wire fields live on the source types; the contract follows.** `LlmConfigurableProvider.consoleUrl` and `LlmModelDiscoveryRequest.validate` are declared once on `dsh-llm`'s types, and the generated Typert contract (`@Remote listConfigurableProviders`, `@Remote('discoverModels')` on `LlmRuntime`) picks them up — there is no hand-written wire schema to drift. Cancellation deliberately does NOT ride the request: `signal` stays on the provider-side `LlmModelDiscoveryOperation`, supplied by the Remote carrier, so the wire vocabulary carries only draft facts. The seam still routes drafts untouched; only the adapter reads `validate`.

**The client reaches the probe through the page's operations face.** `ui-settings-models`' `ModelsOperations.discoverModels(settingsNs, request)` forwards to `ctx.remote.llm.discoverModels`; `useKeyCheck(operations)` composes it for both the ProviderEditor 检查 button and the wizard's 配置 step. The carrier answers a refused or failed probe as an outcome object rather than a rejection, so neither the hook nor the wizard's save path catches — the `failed(message)` state and the step-3 error line read the outcome directly.

**The wizard itself is the settled design, unchanged.** Three in-component steps inside the shared modal, 完成 gated on a successful probe, 跳过 keeping the configure-later semantics, the credential write exactly the editor's credential half under `refFor(...)`, completion riding the refreshed join. The readiness projection, slot registration (`deepseek-official`, order 0, after the welcome notice), and trigger (blank Hero plus `credential-missing`) are untouched. The dialog's spec coverage let its entry leave the vitest GUI debt exemption list in `vitest.config.ts`.

## Alternatives considered

**Reviving a wire schema beside the Remote contract.** Rejected: a parallel schema is a second source of truth for the same fields; the Typert generator already projects the declared types onto the wire, codecs included.

**Keeping the dialog's coverage exemption.** Rejected: the rewritten wizard spec covers every step transition, the check gating, the save failure arms, and every unavailable/readiness variant, so the exemption's remaining reason was inertial.

## Consequences

A browser key check now travels `POST /api/llm/discoverModels` with named wire arguments (`{ settingsNs, request }`, `validate` inside `request`) and the answer is the strict-validated model list. The e2e lane stubs exactly that HTTP call to stay keyless; its expected dialog snapshots capture the three-step chrome. The fork-era notes keep their decisions; this note owns only the re-landing facts.

## Testing

`packages/llm/llm/tests/topology.spec.ts` pins the `consoleUrl` directory round-trip and the `validate` pass-through to the adapter. `packages/llm/llm-pi-ai/tests/{catalog,dynamic-config,discovery}.spec.ts` pin the console-url/display-name tables and the `validate` short-circuit withdrawal, catalog-endpoint fallback, and records-no-endpoint refusal. `packages/llm/llm-deepseek/tests/discovery.spec.ts` drives the interrogation against local HTTP servers. `packages/client/ui-settings-models/tests/{key-check,onboarding-dialog}.client.spec.tsx` cover the shared check and every wizard path. `apps/web/tests/onboarding-deepseek-config.e2e.ts` walks the wizard against the real host with the discovery call stubbed at the `/api/llm/discoverModels` route; the refreshed goldens under `apps/web/tests/expected/` pin the rendered steps.
