---
title: Architecture
description: Ownership, dependencies, compilation and runtime invariants.
---

# Architecture

This section specifies how source programs, compilation, sessions and views fit together. Message shapes belong to [Communication](../communication/); serialized records belong to [Exchange formats](../formats/).

## Responsibilities and boundaries

| Owner | Responsibility | Boundary |
| --- | --- | --- |
| `@pcbjs/core` | Design vocabulary, types, identities, canonical model and shared protocol declarations | Shared contracts must not depend on an editor or viewer implementation |
| `@pcbjs/compile` | Evaluate and flatten a design, place, route, finish geometry and run checks | Produces board data; does not own a VS Code tab or canvas |
| `@pcbjs/export` | Convert compiled results into viewer facets and manufacturing artifacts | Exported SVG is a representation of the board, not the canonical model to parse back |
| CLI project runtime and session | Load projects, own source authority, schedule compilation and distribute state | Each checkout has its own session identity; projects have their own compile state |
| `@pcbjs/ui` and viewer | Render facets and implement selection, cameras and editing gestures | A local preview is not a committed source change |
| Editor and agent clients | Supply source buffers, request operations and present results | Requests retain the originating project, board and target through asynchronous work |
| Platform and browser worker | Provide host services and execute supported compilation in memory | Browser caches and Node caches remain separate |

The [package dependency table](./development#packages) describes the packages in detail. The dependency-free [protocol declarations](https://github.com/pcbjs/pcbjs/blob/main/packages/core/src/protocol.ts) are shared by session, editor, language server and viewers.

## Source-to-view flow

1. Resolve project config and registered entries. Evaluate config before entries so defaults are available.
2. Transform TSX and source ranges, then evaluate the design in its project realm.
3. Flatten components into the canonical `Board`: absolute board geometry, nets, footprints, references and source provenance.
4. Run the stage plan required by the requested views. Manual copper precedes automatic routing; tuning and finishing precede the relevant checks.
5. Export and stream named facets. A complete compile can commit a snapshot; a partial compile serves its requested views without claiming a full snapshot.
6. Clients apply results for the correct project, board, target and run. They refuse stale editing targets and request resynchronization when needed.

The full stage table, facet dependencies, cancellation and cache keys are in [Compiler and canonical model](./design#the-stage-graph). Its implementation is [`STAGE_DEFS`](https://github.com/pcbjs/pcbjs/blob/main/packages/compile/src/stages.ts), executed by the [runner](https://github.com/pcbjs/pcbjs/blob/main/packages/compile/src/runner.ts).

## Ownership invariants

- The canonical board uses absolute millimetres with y increasing downward. JSX and SVG-like vocabulary are inputs; exporters all read the compiled model.
- Parts, nets, defaults and source mapping belong to a project realm. Runtime branding identifies values across loader copies; class identity cannot be assumed across them.
- A source edit is applied through the session's source authority and version checks. A renderer cannot infer write permission from a visible object.
- Shared selection carries board, target and snapshot identity. Pane-local camera and presentation state remain distinct from source state.
- Closing one client detaches it. It does not stop a session still used by other clients. [Session lifecycle](../communication/session#lifetime) owns shutdown and idle-grace rules.
- A cached stage is reusable only under its declared inputs and compiler identity. Generated caches are implementation artifacts, not editable source or a portable exchange contract.

## Browser execution

[Browser execution and parity](./browser) defines the virtual project, supported host services, worker messages, cancellation and numerical self-check. A static page can compile its packaged source graph in a worker. That does not grant the page access to a writable development session.

The `Platform` abstraction supplies files, paths, hashing, environment and cache storage. Node is the normal host; browser memory storage does not read or mutate the checkout's stage cache. See [platform.ts](https://github.com/pcbjs/pcbjs/blob/main/packages/core/src/platform.ts).

## Detailed contracts and verification

- [Compiler and canonical model](./design): stage ownership, geometry, caches and provenance.
- [Packages and dependency boundaries](./development): package responsibilities and repository structure.
- [Projects and worktrees](./workspace): discovery, project scopes and routing to the correct runtime.
- [Browser execution and parity](./browser): browser module and execution restrictions.

Stage/cache tests and Node/browser equality tests cover important boundaries. Their presence does not establish that every supported platform passed the current release candidate. The [conformance page](../conformance) separates contract checks from release acceptance.
