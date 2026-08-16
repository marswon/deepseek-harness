# Agent Note: host.revealPath — reveal a path in the OS file manager

Status: implemented

English | [中文](2026-08-16-host-reveal-path.zh.md)

## Problem

The chat surface could open a produced or tool-arg file (`host.openPath`, the [file-open note](2026-07-28-tool-call-file-open-in-os.md)) and open the workspace folder from the produced-files row, but nothing could select one file in the host's file manager — the "where did that land?" gesture users expect next to a path. Opening the containing folder with the default application is not equivalent on macOS or Windows, where the file manager has a dedicated select-and-show invocation.

## Decision

**One privileged unary RPC mirroring `host.openPath` end to end.** `host.revealPath({ path })` shares openPath's wire shape (`{ opened: true }`), its zod schema pair, its fetch-carrier row, its loopback-only pinning in `dsh-client-connection`'s privileged set, and its `openTarget` failure mapping in the gateway (`cancelled` on caller abort, `internal` otherwise). `host.describe` gains `canRevealPath` beside `canOpenPath`; both are platform truths about desktop reachability, so the gateway's single `nativeOpen`/`canOpenPath` override governs both and an injected `defaults.revealPath` counts as revealable by definition.

**Platform mapping lives in `native-path-opener.ts` as a third `PathOpenIntent`.** Reveal dispatches `open -R` on macOS and `explorer.exe /select,<path>` on Windows; Explorer exits with code 1 even on a successful selection, so exactly that numeric code is tolerated while every other rejection (including string spawn-failure codes) propagates. WSL translates through `wslpath -w` into the same Explorer call — the translation step is now shared with the open path. Desktop Linux names no standard reveal gesture, so the containing directory opens through `xdg-open`. The browser-document fast path never applies: reveal is a file-manager gesture, not content display. `canRevealNativePath` shares `canOpenNativePath`'s answers verbatim.

**The client threads one optional callback.** `WorkspacesService.revealPath` mirrors `openPath`; the chat view's inject face gains `revealFile`, present only when the page is loopback and the current Host description reports `canRevealPath` (absent callback = no affordance, the same off-state idiom as `TurnTailOwnerProps` consumers). The callback flows `ChatViewInjected` → `ChatNodeOwnerProps` → `ToolCallOwnerProps` → the three file-path rows (FileMutationRow, ReadRow, GenericToolCard) → `ToolRow.onRevealFile`, which renders a folder icon (`IconFolderOpen16`, copy `reveal.inFolder` = 在文件夹中显示) beside the existing open link; the path link itself keeps its open behavior, and an error row's failure line carries neither gesture. The produced-files row's **Show in folder** action, previously gated on overflow, now renders whenever the turn produced files and the Host can open paths — it reveals the workspace through the same owner `openFile('.')` path as before.

## Alternatives considered

**A `select: true` flag on `host.openPath`.** One method, two gestures — rejected because the wire vocabulary and the capability advertisement stay cleaner as twins: `canOpenPath` and `canRevealPath` answer different questions, and every existing openPath callsite keeps its meaning untouched.

**Reusing `canOpenPath` alone in the describe payload.** Tempting because the platform answers are identical today; rejected so a future platform whose reveal gesture differs (a Linux desktop with a genuine select-in-manager D-Bus path) can diverge without a wire change. The shared override knob is the deliberate concession to that symmetry.

**Gating inside ToolRow via the connection inject pattern (ui-deliverables style).** ToolRow is pure presentation in a package that owns no connection face; the gating belongs to the owner that provides the callback, matching how `inspect` arrives. A component-side gate would also have spread the loopback rule across two packages.

## Consequences

Remote (non-loopback) pages and headless Hosts render exactly the rows they rendered before — the icon simply never appears. The fixture transport answers reveal as a deterministic no-op success like openPath, so keyless lanes can drive the gesture. Windows users see a reveal succeed even though Explorer reports exit code 1; that quirk is documented at the adapter and in the package README. Desktop Linux reveal opens the containing directory without selecting the file — the platform's ceiling, now documented rather than hidden.
