# Agent Note: models settings page restyle

Status: implemented

English | [中文](2026-08-16-models-settings-restyle.zh.md)

## Problem

The Settings → 模型 page mixed a hand-rolled capsule-button set with bare native controls: the fetch-available-models dialog listed unstyled checkboxes, model-catalog rows were a cramped four-column grid with 6px padding and two auto icon cells, and the 自定义设置 fold drew its own CSS-triangle chevron. The page read as rougher than the settings chrome around it, and the bespoke button geometry had drifted from the primitives.

## Decision

**Route every control through the primitives, keep the copy and the flow.** All buttons became ui-primitives `Button` (outline/ghost/primary, small where dense), with the two local color overrides (`.dangerButton`, `.linkButton`) and the 44px dashed add cards kept as scoped overrides; all text fields became ui-primitives `Input`, gaining the brand focus ring and placeholder token for free. Because `Button` ships no focus ring, the module adds scoped `:focus-visible` rules (section, both dialogs, summary, icon buttons) plus a scoped `box-sizing: border-box` fix for the outline-vs-primary 2px height skew. The model-entry rows got breathing room (padding 6→8, radius 8→10, fixed 28px icon cells, hairline above capacities) and both editors now share the same 14px chevron/trash primitives wrapped in `aria-hidden` spans. The fetch-models dialog lists candidates as token-styled rows: bordered scrollable container, hover fill, `:has(:checked)` selected fill, 14px `accent-color` checkbox, and a `:focus-within` row ring. The `<details>` chevron is `IconChevronDownOutline14` with a rotate transition (off under reduced motion). The single stylesheet shrank 675→~560 lines as the duplicated button geometry left.

## Alternatives considered

**Adding focus rings to the `Button` primitive itself.** The right long-term home, but every other consumer currently relies on its own patch; changing the primitive here would have widened the blast radius to pages this change never touched. Scoped rules keep the restyle local; the primitive-level fix is recorded as a follow-up.

**Copy tweaks while restyling.** Rejected: the e2e lane pins Chinese strings through aria goldens, and visual polish should not churn wording review.

## Consequences

No behavior or copy changed; every visible string is byte-identical. One aria golden (`models-settings/declared-edit`) gained the add-model button's icon `img` node — refreshed in the same change after diff review. The styles token guard still passes, so every color/shadow resolves through `--dsw-alias-*`. The 217 package specs were untouched and stay green, which is the point: presentation moved, behavior did not.
