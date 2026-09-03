# Agent Note: Webworker image admits resolvable bare bundle names

Status: implemented

English | [中文](2026-09-03-webworker-image-bare-bundle-names.zh.md)

## Problem

The web profile template names the community plugin marketplace as the bare bundle `dshmarket` ([bundle note](../feature/2026-08-16-bundle-dshmarket-into-web-profile.md)). The [webworker image packer](../architecture/2026-08-20-webworker-pack-lowering-and-preview.md) dropped every bare row name: its roster heuristic counted only names with a scope or a path separator, because preset metadata (agent preset ids) shares the bare-name shape. Even collected, `dshmarket` would not have resolved — the packer resolved roster seeds only from the repository root, while pnpm keeps the CLI-only dependency under `apps/cli/node_modules/`. The packed web preview therefore failed to boot: the Loader could not resolve `dshmarket` inside the image.

## Decision

Resolvability, not name shape, discriminates packages from preset metadata. `moduleNamesOf` collects bare string names into a separate set; `packVfsImage` admits one into the roster only when the workspace index carries it or it resolves from the primary root or a caller-passed install anchor (`PackOptions.rosterResolveFrom`). Seed materialization resolves across the same anchors; transitive dependencies still resolve from their importer's directory alone. `repository.ts` exports the CLI package directory as the anchor, and both pack call sites (`bin.ts` and the preview-boot self-pack) pass it.

Admission alone is not enough: the reachability sweep rooted only workspace export faces, so an external roster seed's JavaScript was pruned as unreachable and the image still lacked `dshmarket/lib/index.js`. The sweep now roots the export faces of every materialized roster package — workspace and vendored packages are addressed by constructed name at runtime, and an external seed is named directly by a Loader row. Transitive third-party dependencies keep no face roots and stay prunable through their importers.

## Alternatives considered

**Whitelist known bare bundle names.** A name table in the packer duplicates the profile template's choice and drifts from it; resolvability reads the ground truth the installation already holds.

**Resolve every seed from the CLI package directory.** The packer library holds no repository knowledge by design; hardcoding the CLI anchor into `pack.ts` would break that split, so the anchor arrives as an option from the repository adapter's callers.

**Hoist `dshmarket` to the root workspace dependencies.** A root dependency would exist only to serve the image pack, and pnpm still would not guarantee the hoist; the CLI anchor matches how the real boot resolves bundles (profile directory plus CLI installation).

## Consequences

The packed web preview carries `dshmarket` and its dependency closure, with the seed's entry reachable through the sweep. Any future bare-named bundle the CLI installs joins the image without packer changes; a bare name that resolves nowhere stays out of the roster and is never reported missing. The admission check costs one resolution walk per bare name at pack time, and a rooted external seed keeps the JavaScript its export faces reach. Spec coverage: a resolvable bare name enters the roster and the image, an unresolvable one stays out with `missing` empty, and an anchor-only package resolves through `rosterResolveFrom` with its entry file surviving the sweep.

Image completeness and runtime capability are separate questions: the preview boot now reaches `dshmarket`'s activation and stops inside its `undici` chain, which requires Node builtins the worker's compatibility table does not implement (`assert`, `console`, `diagnostics_channel`, `dns`, `http2`, `querystring`, `timers`, `tls`) and whose I/O paths need real sockets the worker's `net` mock refuses. That residual is a webworker-runtime capability decision, not a packer gap.
