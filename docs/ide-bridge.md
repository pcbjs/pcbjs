# IDE bridge

Editor/viewer session protocol: connections, versions, language segments and HTTP endpoints.
Advanced. For other-editor clients; VS Code: editor.md, vscode.md.

```text
editor reads     <project>/.pcbjs/dev.json: {"session":"k3v9q2mz","pid":4242,"socket":"/work/p/.pcbjs/session","url":"http://127.0.0.1:51234/",…}
editor connects  the socket, or the named pipe on Windows; without one ws://127.0.0.1:51234/__pcbjs/session
editor -> session {"event":"pcbjs:ide:hello","data":{"name":"ed","version":"1.0.0","protocol":6,"major":1,"capabilities":["boards","scopes","scope","log","lsp"],"role":"editor","project":"/work/p"}}
session -> editor {"event":"pcbjs:ide:ready","data":{"port":51234,"pid":4242,"session":"k3v9q2mz","mode":"rw","projects":[…],"protocol":6,"major":1,…},"seq":1}
editor -> session {"jsonrpc":"2.0","id":1,"method":"initialize","params":{…,"initializationOptions":{"pcbjs":{"protocol":6,"major":1,"capabilities":[]}}}}
```

## The declaration

Dependency-free `@pcbjs/core/protocol` declares all frames: `PROTOCOL`, `MAJOR`, `compat()`; `Methods` with params, results and write status; `WRITE` for methods refused read-only; server `Events`, client hello `Sends`; viewer `PagePost` and `HostPost`; language-server `METHODS` and segment types. Tables below explain purposes; field definitions live in that module.

## Connecting

- Read each folder's `.pcbjs/dev.json`, check its pid and connect. Otherwise start `<dir>/node_modules/.bin/pcbjs session serve --workspace <folder>... --port 0 --host 127.0.0.1` detached with `NO_COLOR=1`, logging to `.pcbjs/log/session.log`; connect when dev.json names its live pid. Use the nearest pcbjs, else a global one.
- Frames are JSON objects: one per socket/pipe line or WebSocket message. Events use `{ "event": <name>, "data": <payload> }`; JSON-RPC 2.0 has `jsonrpc`. Ignore unknown events, fields and capabilities.
- Hello `capabilities` selects editor events; each hello also gets the last `scopes`, `scope`, `boards`. `role: 'editor'` holds synced files, session.md.
- `session/*` shares the language connection; use distinct request ids.
- Close to detach. Loss without `pcbjs:ide:bye` retries from 0.5 s, doubling to 10 s, starting a session if none is live.

| Event | Direction | Meaning |
| --- | --- | --- |
| `pcbjs:ide:hello` | to session | first frame |
| `pcbjs:ide:ready` | to editor | after hello and each project attached |
| `pcbjs:ide:scopes` | to editor | after each load, compile or switch |
| `pcbjs:ide:scope` | to editor | the scope shown last changed |
| `pcbjs:ide:boards` | to editor | each compile; a board's `status` is `ok`, `error` or `incomplete` |
| `pcbjs:ide:log` | to editor | each `[pcbjs]` log line |
| `pcbjs:ide:bye` | to every client | the session ends |
| `session/state` | to every client | the heartbeat, session.md |
| `session/event`, `session/reset` | to a follower | an event of queries.md after `session/events { follow: true }`; a cursor gone |
| `session/message`, `session/acked` | to its target | a note through `session/send`, mcp.md; the ids a harness acknowledged through `session/inbox` |
| `pcbjs:status`, `facet`, `invalidate`, `boards`, `error`, `focus`, `scopes` | to viewers | the compile, the focus, viewer.md |
| `pcbjs:select`, `sync:hover`, `assist`, `assist:focus`, `grid` | to a board's viewers | the selection, a hover, the editor's assist |
| `pcbjs:editor`, `pcbjs:agents` | to viewers | an editor attached or left; the agents |

Cursor selections and active files use `pcbjs/focus`, closes use `textDocument/didClose`, session selections use `pcbjs/select`, not events. Their resulting events name `by: { client, name, role? }`.

Viewer `pcbjs:focus` chooses the first live board importing the file, else an isolated preview; another scope switches first.

## Versions

- `hello`, `ready` and `initializationOptions.pcbjs` require `protocol`, `major`, `capabilities`; dev.json has `protocol`, `major`. Missing fields or another `major`: hello gets a notice and `pcbjs ide install` warning; initialize gets standard LSP only. `protocol` only adds; newer peers get the server's version.
- `compat(peer)` returns `same`, `older`, `newer` or `incompatible` for session, extension and viewer banners.
- Capabilities are the events a side takes, plus `lsp` for an editor with a language client and a server with @pcbjs/lsp; start no language client without it.
- Current: protocol 6, major 1. Version 6 made viewers session clients; 5 added `run` to facets and heartbeat. Extension and viewer flag older versions; extension `version` tracks `@pcbjs/pcbjs` major/minor.

## Language server

First `initialize` loads `@pcbjs/lsp`, failing if absent. JSON-RPC uses separate frames; one language server per connection.

`Host.events` carries the compiled project root: assist `project`, resolved completion `endFocus`, first argument of `grid(project, board, grid)`. Viewer frames are unchanged.

- `initialize` carries `initializationOptions.pcbjs`, `ClientHello`; without it, standard methods only.
- `capabilities.experimental.pcbjs`, `ServerHello`: lower protocol, honoured client capabilities, none yet, and pcbjs methods.
- Full sync and saves use the session document store; changed text compiles as a draft. Editors hold synced files; agents hold only files no editor holds, session.md. LSP positions: 0-based lines, UTF-16 characters.

| Method | Answers |
| --- | --- |
| `textDocument/documentHighlight` | the innermost range that drew items, and ranges that drew the same items or parts |
| `textDocument/hover` | preview, value, what it drew, route length, target and skew, findings |
| `textDocument/definition` | placement to definition and back, pad reference to placement, a layout's instances |
| `textDocument/codeLens` | route length, target, group, skew; a helper's routes; a layout part's instances; findings |
| `textDocument/completion` | a `route()` end slot's open ends, editing.md |
| `completionItem/resolve` | the item, lit in the views |
| `textDocument/inlayHint` | pad nets, `net GND` or `nets A/sl, B/sl`; rule widths, `width 0.2 mm` |
| `textDocument/publishDiagnostics` | findings: `source` `pcbjs DRC`/`pcbjs ERC`, `code` the rule; draft spans: Unnecessary hints, `pcbjs draft`; disk writes under unsaved text: `shadowed`, `pcbjs session` |

Compiles refresh code lenses and inlay hints. Markdown hover starts with `![<kind> on <board>](data:image/svg+xml;base64,…)`: `kind` is `placement`, `items`, `pad`, `net`, `keepout`, `footprint`, `model`, `group`, `point` or `reference`. SVG size: 360 px wide, at most 198 high; `data-box`: crop `x y w h` in mm.

| Method | Kind | Meaning |
| --- | --- | --- |
| `pcbjs/focus` | client to server | `FocusParams`: focus, the primary cursor and every selection, the primary first; switches board or scope and sets the selection |
| `pcbjs/select` | server to client | `SelectParams`: multi-cursor ranges, one per member, primary first; shown with `reveal`, focus kept unless `focus` |
| `pcbjs/preview` | server to client | `PreviewParams`: the page to show, after the handshake and a scope switch; the client adds `ide` and `theme` |
| `pcbjs/segments` | request | `SegmentsParams`: editable segments of the file, a range or `position`; with `value`, its presentation |
| `pcbjs/tokens` | request | the numbers, units and layers in coordinate strings, for a client that colours them itself |
| `pcbjs/flush` | request | null once every earlier message is handled, before a query |
| `workspace/applyEdit` | server to client | a session write, when the client declares `workspace.applyEdit` |

### Segments

The server computes edits; the client applies them without an apply message. `Segment` holds range, kind, value, constraints, presentations with `TextEdit`, and `Widget`. Typed values return one presentation in the literal's unit and grammar, or `error`. Widget `input`: `number`, `length`, `angle`, `position`, `layer`, `enum`, `text`, `none`; unknown means text.

| Kind | Values |
| --- | --- |
| `number`, `length`, `angle` | a plain number, `.impedance(90)`; a length in the unit written; a position's rotation |
| `position` | `at`, a route end or chain target, `x y [rot or layer]` |
| `layer`, `enum` | a layer name or alias, the board's in `choices`; a side, a copper count |
| `pathCommand` | one path command, `grammar` `route` or `svg`, or one chain call such as `.V(14)`, `grammar` `chain` |
| `pinRef` | route-end pad, `J1[3]` or `J1['B4']`, or helper argument; presentations: other part pads, `J1/2`; input `B4` or `J1/B4` |

Render the widget, not the kind; new kinds need no client changes.

## Selection

- Each board has one selection, independent finding focus and pending/chosen isolation layout, viewer.md. `pcbjs/focus` resolves ranges to entities, empty ranges to innermost tokens; their union is selected `by: 'editor'`, primary as anchor. A cursor on nothing clears only editor-set selection. Other selections reach editors as `pcbjs/select`: complete part placement in its originating `view`, pad connect key, route call or net declaration. Ignore focus notifications caused by your own change.
- `session/select` sets it from any connection, `by: 'agent'` for an agent, a viewer's whole selection with `selection` and `base`, answering the selection; `refs: ['board:<name>']` alone keeps it and reveals the entry's `<PCB` in each editor.

## Viewers

- Viewer pages use `role: 'viewer'`; Vite's socket carries only source hot updates.
- `session/observe`: first call gets boards, focus, heartbeat; board switches get selection/assist unless `select` is false; every call gets facets differing from `held`, session.md. `session/resync` resends all facets and answers the incident.
- `session/hover` without id reaches other board viewers. Selection carries `base`, its starting `seq`; the session stamps `seq`, broadcasts and drops changes older than that viewer's last.
- `pcbjs:assist:focus` lights as a hover; null clears it as the cursor leaves the slot, or a second after an edit with no new resolve.
- Panes use `<url>?ide=1&theme=<dark|light|hc>`, `view=2d|3d|sch|checks` for one headerless view, `panel=0` for no panel. Parent `HostPost`: `pcbjs:net` selects a net, null clears; `pcbjs:finding` focuses a finding; `pcbjs:select` takes refs, `by: 'tree'` from trees, viewer.md. `board` switches first. Page `PagePost`: embed selection and chip `pcbjs:send`, mcp.md.

## HTTP endpoints

| Request | Reply |
| --- | --- |
| `GET /__pcbjs/open?file=&line=&col=&endLine=&endCol=&pad=&board=&at=` | selects and reveals the range, its `at` value with `at=1`, or the connect key of `pad`, such as `R1/2`, with `focus`; 204 with `x-pcbjs-opened` `ide` for the session's language clients, or `editor` for launch-editor; 400 without `file`, 404 for a file Vite may not serve |
| `GET /__pcbjs/ide` | `{ connected, clients: [{ client, name, role, kind, mode, version }] }`, the session's connections |
| `GET /__pcbjs/<board>/board.json` | site data of the scope of the page that asks |

A finding click synchronizes applicable views through the session selection's `finding` field. Editors advertising `finding` receive `pcbjs:ide:finding`. VS Code opens or reuses the persistent DRC/ERC viewer at `view=checks`: structured HTML details, expandable findings list, previous/next navigation and an icon-only Copy as Markdown action. The first opening prefers the visible board source group, then a non-preview group, then an inactive preview group, else a split. The active preview keeps focus. Entity clicks and text-range selection synchronize references. Source focus and a cleared finding leave this viewer open; closing its final pane clears finding focus. Full diagnostic sentences appear only in DRC/ERC, never on schematic, 2D or 3D surfaces. A copied viewer URL uses `focus=<finding-id>` independently of `select=`.

Coordinate-string cursors keep their placement selected, like the rest of its syntax block. Viewer clicks select whole source expressions. `session/select { project }` disambiguates reused board names; unknown projects are refused.

Checks requests `pcbjs:copy-markdown { id, text }`; the host answers `pcbjs:copied-markdown { id, ok }`. Matching ids confirm clipboard success.

The derived `pcbjs:ide:finding` event optionally includes `target: string | null` and `snapshot: string` from canonical selection. Its finding payload remains available for existing protocol 6 consumers. These additive ownership fields require no protocol version change; older clients may ignore them. Full `session/select` selection offers validate their reference strings, target, snapshot, focus, isolation, marks and nonnegative sequence/base before changing session state.

`session/layout` is an additive read-only protocol 6 request with `{ board, target, ref }`. It returns the selected reusable layout geometry with effective instance parameters, shared source ownership and its own placements suppressed. The session validates project, board, target and group ownership, and caches by snapshot and target. The server advertises the `layout` capability. PCB and schematic viewers load the reusable template lazily and ignore stale replies; checks retain the canonical board. A client connected to a server without this capability reports library preview as unsupported and asks for an update/restart.

Source navigation preserves the originating preview group through document opening, layout lookup, split creation, source-tab movement and reveal. Host mutations are serialized because VS Code cannot cancel an in-flight editor-open command. Newer requests supersede older caret updates; focus changes cancel subsequent operations and focus restoration. Destinations are resolved by group identity before each command, so renumbered columns cannot redirect the source into the originating preview. An already-running host command may finish before cancellation takes effect.
