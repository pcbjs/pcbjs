---
title: Communication protocols
description: Discovery, transports, handshake, RPC, synchronization and recovery.
---

# Communication protocols

The session is the coordination endpoint for editors, viewers, CLI clients and agents. This section owns peer lifecycle and message exchange. Field-level definitions are centralized in [core/protocol.ts](https://github.com/pcbjs/pcbjs/blob/main/packages/core/src/protocol.ts).

## Transport boundaries

| Boundary | Encoding / endpoint | Detail |
| --- | --- | --- |
| Local client → session | Newline-delimited JSON over UNIX socket or Windows named pipe | [Session listeners](./session#listeners) |
| Browser viewer → session | One JSON frame per WebSocket message at `/__pcbjs/session` | [IDE bridge](./ide-bridge#connecting) |
| Language client → language service | LSP JSON-RPC; session integration or documented stdio adapter | [Language-server integration](./lsp) |
| Agent host → MCP adapter | MCP tools/resources and pcbjs session integration | [Agent protocol](./mcp) |
| Host editor ↔ embedded page | Declared `HostPost` / `PagePost` messages | [Bridge declarations](./ide-bridge#the-declaration), [Embedding](../interaction/viewer#embedding) |
| Browser main thread ↔ compile worker | Typed worker messages and packaged `BrowserModule` | [Worker protocol](../architecture/browser#the-worker) |

Vite's hot-reload transport updates application code. It is not a substitute for the session's board-state protocol.

## Connection lifecycle

1. Discover the session record for the intended checkout/project and verify it is live. Start or join a session only through the documented client workflow.
2. Connect using the recorded socket/pipe or session WebSocket endpoint.
3. Send `pcbjs:ide:hello` with role, version, protocol, major and capabilities.
4. Receive `pcbjs:ide:ready`, identify served projects and the connection's read/write mode, then subscribe or observe the required data.
5. Editors initialize language services when negotiated; viewers declare board, target, scope and requested facets.
6. Process requests, events, invalidations and state heartbeats while retaining originating identity.
7. On close, detach and release client-owned resources. On unexpected loss, apply the documented reconnect policy; a deliberate `bye` is a shutdown signal.

The [wire contract](./ide-bridge) includes an actual handshake example, event tables, method purposes and compatibility behavior. The [session contract](./session) defines discovery files, source ownership, snapshots, demand and shutdown.

## Framing and compatibility

Events use an `event` name and `data` payload. Requests and responses use JSON-RPC 2.0. Socket and pipe frames are newline-delimited and bounded by the session's frame limit; WebSocket message boundaries carry the frames directly. Clients need distinct request IDs when sharing the connection with language traffic.

The current shared constants are **protocol 6, major 1**. Protocol revisions are additive; major changes mark incompatibility. `compat()` returns same, older, newer or incompatible. Session requests require a compatible hello. Only local socket/pipe `session/status` and `session/stop` bypass it so an outdated server can be inspected or stopped. LSP initialization retains its separate handshake. The optional `layout` server capability enables library previews; its absence displays an unsupported state with an update/restart instruction. Unknown additive events, fields and capabilities are ignored as described by the bridge contract.

Capabilities, protocol versions and write permissions are separate checks. A correctly versioned client may still be read-only. `Methods` owns parameter/result types; `WRITE` owns the methods refused to read-only connections. Do not maintain a second independent write-method list in an adapter.

## Synchronization and recovery

Each connection's sequence and each compile's run identify different orderings. Facets and invalidations carry the run that produced them; heartbeat state permits clients to detect disagreement and request resynchronization. A stale event cannot be allowed to overwrite a newer board simply because it arrives later.

Canonical selection is replayed as state, not echoed back as a new user action. Project, board, target and snapshot remain attached to delayed operations. A result for a previously focused board must not mutate whichever board happens to be active when it arrives.

A complete snapshot represents committed compilation, while a transient draft or partial facet does not. Query envelopes explicitly report stale results. Source writes use authority and version checks rather than assuming the last received geometry is still editable.

## Access and lifetime

The session's `localhost`, `all` and `none` editing modes define which transports and clients may write. LAN read access is not equivalent to edit authorization. Token handling and browser-origin checks belong to the [session contract](./session#modes).

An editor window reload must close obsolete clients and allow restored panes to reconnect. Closing a window does not forcibly terminate a shared session still used elsewhere. Session idle grace, explicit stop and checkout-scoped development purge are distinct lifecycle operations. The [extension specification](../interaction/vscode) describes host behavior; [editor actions](../interaction/editor-actions) defines visible outcomes.

## Verification boundary

Protocol unit tests, socket integration tests, worker equality tests and installed-editor tests exercise different layers. A handshake test alone does not prove reload recovery, source ownership, stale-event rejection or iframe keyboard forwarding. See [Conformance](../conformance).
