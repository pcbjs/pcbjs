---
title: Interfaces
description: API ownership, inputs, results, side effects and integration boundaries.
---

# Interfaces

An interface defines what a caller can request and what the owner returns. The [communication section](../communication/) defines how requests cross process boundaries; [formats](../formats/) defines the records carried across them.

## Interface families

| Interface | Caller and owner | Contract |
| --- | --- | --- |
| Design API | Source module → core/standard library | Typed values and JSX nodes; [syntax](../syntax/) governs semantics |
| Compile API | Host → compiler | Compile options, cancellation, requested views and board results; [Compiler and plugin APIs](./plugins#compiling-from-code) |
| Plugin API | Compiler → registered plugin | Declared stage inputs/outputs, hooks, deltas and checks; [Plugin contract](./plugins) |
| Platform API | Compiler → host environment | Files, paths, hashing, environment and storage; [Platform definition](https://github.com/pcbjs/pcbjs/blob/main/packages/core/src/platform.ts) |
| Viewer API | Vite/application → UI component | `BoardRef`, facet imports, component props/events and embedding; [UI integration](./ui) |
| Query API | CLI or agent → project snapshot | Entity records, resolution, events, scripts and stale envelopes; [Queries](./queries) |
| Render API | CLI/session caller → renderer | View, camera, selection, marks and image result; [Rendering](./render) |
| Editor/agent adapter | Client → session, LSP or MCP adapter | [Protocol declarations](../communication/ide-bridge), [LSP](../communication/lsp), [MCP](../communication/mcp) |

## Side-effect boundaries

A compile returns geometry and findings; it does not itself select an editor tab. A UI component renders and requests operations; displaying an object does not authorize modifying its source. Export/build commands can write generated artifacts without implying a design-source edit. Queries return a snapshot or an explicit stale result, not an assumed live mutable board.

Source changes go through the session's [Sources authority](../communication/session#documents). The caller must preserve the file version and originating project/board/target. A failed or unavailable operation must not be reported as a successful edit. Rendering may execute a supplied script only under the permission rules of the session method; plain image requests and scripted requests are not interchangeable.

## Plugin obligations

Plugins declare the stages they add and the facets their work reads and writes. Hook deltas apply at the documented boundary. A plugin cannot safely mutate arbitrary existing items or rely on an undeclared input while expecting correct incremental caching. The stage runner and freeze checks enforce parts of this contract.

Registration order, available slots, hook signatures, `ctx.resolve`, emitted deltas and custom findings are defined in [Compiler and plugin APIs](./plugins). Exact shapes live in [plugin.ts](https://github.com/pcbjs/pcbjs/blob/main/packages/core/src/plugin.ts); avoid importing another package's private implementation by a relative source path.

## Viewer obligations

The four viewers consume the facets appropriate to their job: 2D, 3D, schematic and DRC/ERC. A missing optional representation must be presented as unavailable rather than replaced with unrelated geometry. An embed can communicate through the declared host/page messages; it must not manufacture a second competing selection protocol.

Browser-facing components must be safe to import and render in an SSR environment. Browser globals and renderer initialization belong to the appropriate client lifecycle. A built static site has no source editing authority merely because its component has the same visual appearance as a development preview.

## Authority and verification

| Source | Owns |
| --- | --- |
| [core/plugin.ts](https://github.com/pcbjs/pcbjs/blob/main/packages/core/src/plugin.ts) | Compile/plugin interfaces |
| [core/platform.ts](https://github.com/pcbjs/pcbjs/blob/main/packages/core/src/platform.ts) | Host services |
| [core/site-facets.ts](https://github.com/pcbjs/pcbjs/blob/main/packages/core/src/site-facets.ts) | Board references and facet contracts |
| [core/protocol.ts](https://github.com/pcbjs/pcbjs/blob/main/packages/core/src/protocol.ts) | RPC parameters/results, write classification and host/page frames |
| [ui/index.ts](https://github.com/pcbjs/pcbjs/blob/main/packages/ui/src/index.ts) | Exported UI components |

A package's exported API and its internal helpers are different compatibility surfaces. This section does not declare every repository function to be stable. Type tests, plugin tests, query tests and browser integration tests provide different evidence; use [Conformance](../conformance) to determine the required acceptance level.
