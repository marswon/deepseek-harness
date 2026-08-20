# Agent Note: bound the exact-config watch to its own path chain

Status: implemented

English | [中文](2026-08-20-hmr-exact-config-watch-scope.zh.md)

## Problem

`dsh web` failed to boot on Linux with `ENOSPC: System limit for number of file watchers reached, watch '<userData>/harness/profiles/web'`, exiting the Harness child with code 1 and leaving the desktop shell with a ready URL that serves nothing.

`Hmr.registerConfig()` watches one exact user patch file. When that file does not exist yet, `findWatchRoot` walks up to the deepest existing ancestor and watches it with `depth` set to the remaining distance — for `profiles/web/desktop.patch.yml` that root is `profiles/web`, whose siblings include the profile's entire installed dependency tree. Chokidar's `depth` bounds how far recursion descends, but it still enumerates each visited directory and registers a native watch per entry it admits, so a `depth: 0` watch of `profiles/web` still cost one inotify handle for every top-level entry in that directory, including `node_modules`. Linux's default `fs.inotify.max_user_watches` is small enough that a populated web profile exhausts it during the initial scan.

The failure is not specific to the desktop shell: any `dsh web` run whose `$DSH_HOME/profiles/<name>` holds both a user patch file and an installed bundle tree hits the same ceiling. macOS did not surface it because its FSEvents backend does not consume a per-path handle.

## Decision

**Watch only the chain that can lead to the target file.** `registerConfig()` now passes chokidar an `ignored` predicate built by `exactConfigIgnored(watchFilename, root)`. The predicate admits the target path, each ancestor directory between it and the watch root, and any prefix of the target that does not exist yet (a directory the user may still create), and rejects everything else. `depth` stays as `findWatchRoot` computed it — it remains the correct recursion bound; the predicate is what removes sibling entries from the scan.

**Expose the watch cost as an observable fact.** `Hmr.watchedConfigPaths(filename)` reports the sorted absolute paths a registration currently holds open, so the invariant that matters — the handle count stays bounded next to an installed dependency tree — is assertable rather than inferred from the absence of a crash. `packages/boot/app-boot/tests/hmr-config.spec.ts` asserts that a registration in a directory seeded with a `node_modules`-shaped tree watches only the chain, and that watching still fires for creation, change, and removal of the target.

## Alternatives considered

**Raise `fs.inotify.max_user_watches` from the deb maintainer script.** Treats a system-wide kernel limit as this application's to spend, breaks the AppImage and any non-deb install, needs root, and still fails for a user whose profile grows past whatever ceiling was chosen. It is the right immediate unblock for an affected user and the wrong fix for the product. Rejected.

**Switch `usePolling: true` for exact-config watches.** Removes the handle cost but spends a timer wakeup per interval for a file that changes only when a human edits it, on every session for every user. Rejected.

**Watch the nearest existing ancestor that is not a profile directory, or special-case `node_modules`.** Encodes one deployment's directory naming into vendored HMR, and still enumerates whatever else happens to sit beside the target. The predicate makes the scope exactly what the registration asked for, with no knowledge of what the neighbours are. Rejected.

**Drop the missing-parent case and require the patch file to exist before boot.** The registration exists precisely so a patch layer added later applies without a restart, and `registerConfig` keeps `ignoreInitial: false` so a file present at registration applies once. Rejected.

## Consequences

An exact-config registration now holds one handle per directory in its own path chain plus the file, independent of how many packages the profile has installed. `watchedConfigPaths()` is a new public method on the vendored HMR service; it reads chokidar's `getWatched()` and is the assertion surface for the bound. The change is a vendored local modification, logged as entry 19 in `vendor/README.md`, and must be re-applied after any HMR sync from upstream.

The pre-fix behavior is rejected by the new test: reverting the `ignored` predicate to `[]` fails the chain-scope case. Verified with `packages/boot/app-boot/tests` and `packages/boot/cmdline/tests` (119 tests) plus a `tsc -b` over the `vendor/hmr` and `app-boot` faces. No Linux run reproduced the original `ENOSPC` locally — the handle-count bound stands in for it, since reproducing the crash requires exhausting a real kernel limit.
