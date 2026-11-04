---
title: User interaction protocols
description: Verifiable operation outcomes, focus transitions, transactions and editor-host behavior.
---

# User interaction protocols

Every UI operation needs a defined trigger, target, observable result, source effect and cancellation rule. This section specifies those contracts across 2D, 3D, schematic, DRC/ERC and VS Code. A visible button or a registered command alone is not evidence of correct behavior.

## State ownership

| State | Owner / lifetime | Source effect |
| --- | --- | --- |
| Hover | Transient prospective target in applicable views | None; does not jump the editor |
| Canonical selection | Session-scoped board, target, snapshot, members, anchor and context | None until an eligible edit is committed |
| Finding focus | Shared selection's finding identity and affected entities | None; details live in the checks viewer |
| Instance/library context | Shared editing scope interpreted by applicable views | Determines where an accepted edit writes |
| Camera and layer presentation | Pane-local view state, with focus fitting transactions | None |
| Edit gesture | Local preview, then one version-checked source transaction | One accepted write; cancellation writes nothing |
| Editor tab placement | Host/editor-group policy tied to the originating pane | Navigation only |

The shared record is [Selection](https://github.com/pcbjs/pcbjs/blob/main/packages/core/src/selection.ts). `Shell`, `BoardStore` and `PaneState` separate application, board and pane state. A view may ignore a selection it cannot render, but must not replace it with a competing local selection.

## Focus transitions

| Trigger | Required result |
| --- | --- |
| Click an eligible entity | Select the intended entity and reveal its generating source expression; preserve the clicked preview |
| Place the caret inside an eligible syntax block | Keep the entity focused throughout the block, including inside a coordinate string |
| Focus a finding | Synchronize affected geometry in applicable views and select the finding in the persistent DRC/ERC viewer |
| Move between findings | Update shared focus without reopening the viewer |
| Cancel focus | Restore a camera that automatically fitted to that focus to its pre-focus state |
| Select an unrelated entity | Clear obsolete finding focus |
| Close the final checks pane in VS Code | Clear shared finding focus |

The schematic fits a finding only when it has a visible corresponding marker. PCB-only findings do not force an unrelated schematic zoom. Full finding messages and evidence appear only in DRC/ERC; drawing hover bubbles show the finding type.

## Instance and library editing

The first group click focuses the group and exposes instance/library choices below the view-state badges. Clicking into that group is equivalent to entering instance layout. Clearing member focus dismisses instance editing. Library editing remains until the context is explicitly left.

Library mode shows the reusable definition in its local frame without surrounding board placements or instance overrides; schematic mode isolates the corresponding template too. Display numbering starts at zero per prefix. Effective parameters may come from the focused instance, including required parameters with no defaults. This parameter input does not import that instance's placement overrides.

Source navigation targets the definition or instantiation appropriate to the context. [Layout editing](./layout-editing) owns the source-write table and refusal rules. The path chip owns layout actions; duplicated controls beside selected geometry are not part of the contract.

## Edit transactions

An eligible gesture previews locally, validates its source target and version, commits once, then waits for compilation. A moving preview is not evidence of a successful write. Escape cancels the active gesture first and writes nothing. Invalid, stale, read-only or unsupported targets must report why the requested operation cannot run.

Placement controls expose position, rotation, side and grid/snap options. Grid changes persist to source without reinterpreting existing geometry. Trace controls address the exact generating segment; primitive/case conversion and deletion compensate dependent relative endpoints to preserve geometry where specified. Insertion targets the focused segment interior and respects snapping.

Native Undo/Redo in editor previews follows the source document's chronological history, including intervening edits. Standalone previews use conflict-checked per-client session history. These are distinct contracts, not a promise of selective reversal across later source edits.

## Editor-group and lifecycle policy

Source navigation first reuses an eligible existing source tab, including a background tab. It excludes the group containing the preview the user clicked; other preview groups remain eligible under the specified fallback policy. New source tabs use native preview-tab behavior. Pinned and dirty documents retain host protections.

The DRC/ERC viewer first prefers a group currently displaying PCB source, then a group without a preview, then an inactive preview group, then a new split when necessary. This policy is different from ordinary source-tab reuse. It never replaces the active preview that initiated the operation.

Boards-list expansion only expands. Selecting a board resolves that board and its entry, and selecting the already displayed board does not reload it. Root-config boards are top-level rows; other configs use workspace-relative folder labels; worktree groups start collapsed.

Reload and close must dispose obsolete connections, prevent late work from reviving closed panes, and allow restored panes to reconnect. Ordinary pane closure does not stop other clients' shared server. See [VS Code action contract](./editor-actions) and [Extension lifecycle](./vscode).

## Operation catalog and acceptance

The [operation contract](./interaction#operation-index) assigns stable IDs such as `SEL06`, `EDIT05` and `PANEL03`. The [keyboard table](./keys) defines actual bindings. The [source-focus contract](./highlight) and [view/embedding contract](./viewer) cover detailed selection and host behavior.

The [UI inventory](https://github.com/pcbjs/pcbjs/blob/main/scripts/ui-contracts.json) and [VS Code inventory](https://github.com/pcbjs/pcbjs/blob/main/scripts/vscode-contracts.json) connect operations with implementation and tests. Their coverage and missing-acceptance fields must remain honest. Runtime acceptance checks the visible result, exact source diff, cancellation, undo, recompilation and multi-view agreement on the tested candidate.
