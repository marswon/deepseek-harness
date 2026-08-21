# Agent Note: key the staged desktop runtime by platform-arch and probe it before trusting

Status: implemented

English | [中文](2026-08-21-desktop-runtime-arch-keyed-staging.zh.md)

## Problem

An Ubuntu x86_64 user upgraded from rc.33 to rc.35 and the desktop shell died at startup: the supervised child printed `node: 1: ELF...: not found` / `node: 2: Syntax error: ")" unexpected` and exited with code 2. Those lines are dash interpreting an ELF as a script — glibc's `execvp` falls back to `/bin/sh` when `execve` returns ENOEXEC, which for a well-formed ELF means the kernel rejects its machine type: the staged `node-runtime/bin/node` was a Linux binary for a different architecture than the CPU. The release artifacts were cleared byte-for-byte (the deb `md5sums` entries for the bundled node match the official Node.js v22.21.1 dist archive for both x64 and arm64, and AppImage/deb share one staged runtime), so the foreign binary lived only in the user's data root.

The [userData staging note](2026-08-16-desktop-runtime-staged-under-userdata.md) keyed the staged copy by app version alone and trusted the completion marker unconditionally. A home directory shared, synced, or migrated across machines of different architectures — or any manually seeded copy — therefore pinned a foreign-architecture runtime under `runtimes/<version>`, and the marker made it win every later launch with no recovery path short of deleting the directory by hand.

## Decision

**Key the staged copy by platform-arch and make the marker earn its trust.** `stagePackagedRuntime` now stages into `runtimes/<version>-<platform>-<arch>`, so a foreign architecture's copy can never occupy this machine's slot — and the pre-arch-key directories are pruned as stale on the first successful stage, which repairs affected installs on their next launch without manual intervention.

Before the completion marker is written, the staged copy must pass a `node --version` probe. A failed probe triggers exactly one re-copy (a transient copy fault class), and a second failure throws at staging time with the platform/arch named, so a runtime that cannot execute surfaces as a clear startup error instead of dash's mangled shell-script diagnostics three processes later.

## Alternatives considered

**Probe on every launch.** Catches post-marker corruption too, but costs a child process spawn on every startup to defend a state the arch key already makes unreachable in the reported failure class. Rejected; steady-state launches keep the marker fast path.

**Verify a file manifest (sha256) of the staged tree.** Stronger integrity, but the observed failure is executability, not bit rot; a manifest adds a maintained file list and longer staging for a class with no field evidence. Rejected.

**Keep the version-only directory and only add the probe.** On a home shared between two architectures, every launch on either machine would re-stage the other architecture's copy forever — the probe turns a silent brick into permanent churn. Rejected in favor of separating the slots.

## Consequences

The first launch after this change re-stages the runtime once (new directory name) and prunes the legacy `<version>` directories. Steady-state startup is unchanged. The probe runs only on fresh stages. Behavior coverage: `apps/desktop/tests/runtime.spec.ts` (probe retry, persistent-probe-failure refusal, arch-keyed reuse, crash recovery, version change). The packaged artifact itself was never implicated — deb and AppImage carry the official per-arch Node.js dist unchanged.
