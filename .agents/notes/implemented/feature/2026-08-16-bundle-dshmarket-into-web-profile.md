# Agent Note: ship dshmarket in the web profile template

Status: implemented

English | [中文](2026-08-16-bundle-dshmarket-into-web-profile.zh.md)

## Problem

Desktop users had no way to discover or install community plugins without learning the `dsh plugin add` CLI. The community already maintains exactly the right artifact: [dsh-market](https://github.com/dsh-market/dsh-market), an in-app marketplace (设置 → 插件市场) fed by the awesome-dsh-plugin registry with one-click install/update/remove and safety rails (awesome-listed sources only, no build scripts by default, same-origin + loopback guards). Building a static copy of the awesome list into the settings page would have duplicated a worse, stale-by-construction version of it.

## Decision

**Ship dshmarket as a template bundle, not a UI feature.** `PROFILE_TEMPLATES.web` gains `dshmarket` (`packages/boot/app-boot/src/profile.ts`), and `apps/cli` depends on it so the two-anchored bundle resolution finds the package inside any installation (including the desktop's staged runtime). Existing profiles initialized before the change keep working: the old web tuple joins `INSTALLATION_OWNED_PROFILE_TUPLES`, so `normalizeShippedProfile` upgrades exactly those manifests on next load while user-customized lists stay untouched. Zero code was added to the desktop shell or the web UI — the market is a plugin doing plugin things, which is the architecture working as intended.

## Alternatives considered

**A curated static list in the settings page.** Stale on arrival, and install would still need the whole machinery dshmarket already ships (npm tarball fetch, profile patch writes, HMR). Rejected as strictly worse on both axes.

**First-run patch-layer injection from the desktop shell** (writing the market row into the user's `cordis.patch.yml`). Puts product content into a user-owned file and fights the patch semantics; the template tuple + installation-owned normalization is the built-in channel designed for exactly this.

## Consequences

Every `dsh web` boot in this fork composes the marketplace (CLI users of the fork included, not just the desktop app). The marketplace fetches its registry from awesome-dsh-plugin.com at browse time and installs npm tarballs; both need network at use time, never at boot. Installing plugins runs third-party code with the user's privileges — the market's own guardrails apply, and the desktop release notes carry that warning. The supply-chain policy recorded `dshmarket@1.9.0` in `minimumReleaseAgeExclude` (fresh releases age-gate otherwise).
