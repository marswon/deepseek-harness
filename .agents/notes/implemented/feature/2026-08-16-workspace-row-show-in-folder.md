# Agent Note: workspace row — show in the OS file manager

Status: implemented

English | [中文](2026-08-16-workspace-row-show-in-folder.zh.md)

## Problem

Workspace rows in the sidebar offered only Rename/Delete. A user with several workspaces who needed the directory itself — to open a file the agent produced under an unreported name, to drop assets in — had to dwell for the hover card, copy the path, and paste it into a file manager by hand. Codex-style "jump to the workspace" did not exist.

## Decision

**One more row-menu entry riding the existing `host.openPath` seam.** For a directory, openPath's platform openers (`open` / `Invoke-Item` / `xdg-open`) already land in the file manager *at* that directory, so no new wire surface is needed — the workspace menu gains 在文件夹中显示 / Show in folder (`menu.showInFolder`, `IconFolderOpen16`) that calls a new `openWorkspacePath` injected action with the group's `cwd`. The item exists only when the page is loopback and the current Host description reports `canOpenPath` — the same two-fact gate the produced-files row uses, so remote pages render exactly what they rendered before. The ui-workspace plugin's inject roster gains `connection`, and its browser inject face gains `isLoopback`, `openWorkspacePath`, and the `hostDescription` source (bound for components as `useHostDescription`).

## Alternatives considered

**Revealing the workspace directory inside its parent** (`host.revealPath`, see the [reveal note](2026-08-16-host-reveal-path.md)). Rejected for this entry: a workspace gesture wants the directory itself open, not its parent with a selection — openPath is the correct verb here and reveal stays file-level.

**A hover-card button instead of a menu row.** The hover card already shows and copies the full path, but discoverability is exactly the reported pain; the ⋯ menu is where row verbs live (Rename/Delete), so the entry belongs there.

## Consequences

The ungrouped bucket has no backing directory and keeps its menu-free row. The fixture Host description already advertised `canOpenPath: true`, so keyless browser lanes exercise the item; the workspace-menu aria goldens gained one row and were refreshed in the same change. The desktop shell needed nothing: its Harness child is loopback, so the gate passes by construction.
