# IDE bridge

The protocol between pcbjs dev and an editor: the hosted socket, versions, the language server and its segments, the Vite-WS fallback and the HTTP endpoints.
Read it to write a client for another editor; editor.md has the VS Code extension as a user sees it.

## Hosted mode

1. The editor listens on `ws://127.0.0.1:<random port>/<random token>`, answers any other path with 403, and pings every 15 s.
2. It spawns the project's own CLI, `<dir>/node_modules/.bin/pcbjs dev --workspace <folder>... --ide=<url> --port 0 --host 127.0.0.1`, `<dir>` the nearest project, folder or ancestor with pcbjs installed, with `NO_COLOR=1`; without one, a global `pcbjs`.
3. The server dials the URL, reconnecting with a backoff from 0.5 s doubled up to 10 s. `--ide` takes ws or wss on `127.0.0.1`, `localhost` or `[::1]`, any host with `--ide-allow-remote`.
4. To stop it: SIGTERM, then SIGKILL after 3 s.

Each frame is one JSON object: an event `{ "event": <name>, "data": <payload> }`, or a JSON-RPC 2.0 message of the language server, told apart by `jsonrpc`. Unknown events, fields and capabilities are ignored.

| Event | Direction | Payload | Meaning |
| --- | --- | --- | --- |
| `pcbjs:ide:hello` | editor to server | `{ name, version, protocol, major, capabilities }` | first frame |
| `pcbjs:ide:ready` | server to editor | `{ port, host, urls, root, pid, version, folders?, protocol, major, capabilities }` | the server listens; on every reconnect |
| `pcbjs:ide:scopes` | server to editor | `{ scopes: [{ slug, name, dir, root, route, status, stale, displayed, error, boards }], displayed, single }` | workspace server: after every load, compile or switch |
| `pcbjs:ide:scope` | server to editor | `{ scope, root, route, url }` | the displayed scope changed |
| `pcbjs:ide:boards` | server to editor | `{ boards: [{ name, title, entry, targets, status, draft?, skipped? }], single, errors, scope?, root? }` | after every compile; `status` `ok`, `error` or `incomplete`; `draft`: from unsaved text |
| `pcbjs:ide:log` | server to editor | `{ level, text }` | every `[pcbjs]` log line |
| `pcbjs:ide:select` | server to editor | `{ file, line, col, endLine, endCol }` | select and reveal, when no language client takes `pcbjs/select` |
| `pcbjs:ide:cursor` | editor to server | `{ file, line, col }` | the cursor, for an editor without a language client |
| `pcbjs:ide:focus` | editor to server | `{ file }` | the active file, likewise |
| `pcbjs:ide:close` | editor to server | `{ file }` | a file was closed: its isolated preview goes |
| `pcbjs:ide:bye` | editor to server | none | the editor is going away |

Files are absolute, lines and columns 1-based, `endCol` inclusive. On a reconnect the server resends its last `ready`, `scopes`, `scope` and `boards`; an editor matches it to its server by `pid` or `root`.

## Versions

Both ends state `protocol`, `major` and `capabilities` in `hello` and `ready`, the language client again in `initialize`; left out, they mean protocol 1, major 1 and everything of protocol 1. `protocol` grows by additions only, and a server answers every protocol from 1 up to its own. `major` grows only for a change an older peer cannot survive: the extension shows one notice and the server logs a warning, both naming the fix, `pcbjs ide install` in the project.

Editor capabilities are the events it takes, `lsp` and `widget`; server capabilities are the events it takes and `lsp` when @pcbjs/lsp is installed. An editor starts no language client on a server that lists capabilities without `lsp`.

| Protocol | Major | pcbjs | What changed |
| --- | --- | --- | --- |
| 1 | 1 | 0.0.x | the events, the language server and the segment kinds |
| 2 | 1 | 0.1.x | `protocol`, `major` and `capabilities` on `hello`, `ready`, `initialize` and `dev.json`; `widget` on segments |

The extension's `version` tracks the major and minor of the `@pcbjs/pcbjs` that bundles it; a patch changes no protocol.

A focus becomes `pcbjs:focus` for the viewers, `{ board, entry, boards, file, scope? }`: the first live board whose entry imports the file, else an isolated preview of the file's default export; a file of another scope first switches the scope. editor.md has the rules a user sees.

## Language server

The server loads `@pcbjs/lsp` on the first `initialize` only. On the hosted socket JSON-RPC messages are frames of their own, on Vite's the payload of a `pcbjs:lsp` event; one session per connection, a new one per reconnect. Without `@pcbjs/lsp`, `initialize` fails; events still work.

### Handshake

`initialize` may carry `initializationOptions.pcbjs`, `{ protocol, major, kinds, capabilities, name, version }`: the segment kinds it renders, every kind of its version when absent. The answer's `capabilities.experimental.pcbjs`, `{ protocol, major, kinds, capabilities, methods, version }`, has the lower protocol, the kinds it sends, the client capabilities it honours, the custom methods and the pcbjs version. A client with `widget` gets every kind. Without the option a client gets the standard methods alone.

### Standard methods

Text sync is full documents and saves; a document that differs from its file compiles as a draft. Positions follow LSP: 0-based lines, UTF-16 characters.

| Method | What it answers |
| --- | --- |
| `textDocument/documentHighlight` | the innermost range at the position that drew board items, and the other ranges that drew the same items or parts |
| `textDocument/hover` | a preview image, the editable value, what the range drew with counts, paths and nets, its routes' length, target and skew, its findings |
| `textDocument/definition` | placement to footprint definition and back, pad reference to its part's placement, every instance's in a layout |
| `textDocument/codeLens` | per route call length, target, group and skew; per helper call site its routes; per layout part its instances; per call its findings. Empty commands |
| `textDocument/inlayHint` | the net of each pad reference, `net GND` or `nets A/sl, B/sl`, and the width a route got from the rules, `width 0.2 mm` |
| `textDocument/publishDiagnostics` | DRC and ERC findings of every board and target, `source` `pcbjs DRC` or `pcbjs ERC`, `code` the rule; a draft's skipped spans as Unnecessary hints, `source` `pcbjs draft`; after every compile |

After a compile the server sends `workspace/codeLens/refresh` and `workspace/inlayHint/refresh` when the client supports them.

The hover is one markdown `MarkupContent`. With a preview it starts with `![<kind> on <board>](data:image/svg+xml;base64,…)` and a blank line, `kind` one of `placement`, `items`, `pad`, `net`, `keepout`, `footprint`, `model`, `group`, `point` and `reference`: an SVG 360 px wide, at most 198 high, its `data-box` the crop as `x y w h` in mm.

A layout placed several times answers for every instance: `Q1 (A/QH) · Q3 (B/QH)`.

### Custom messages

| Method | Kind | Params | Meaning |
| --- | --- | --- | --- |
| `pcbjs/focus` | notification, client to server | `{ textDocument: { uri }, position, selection? }` | the file in focus and the cursor; the server switches board or scope when the file changes and highlights the cursor in the viewers |
| `pcbjs/select` | notification, server to client | `{ uri, range }` | a viewer click: select and reveal the range |
| `pcbjs/preview` | notification, server to client | `{ url, scope? }` | the page a preview should show, after the handshake and on every scope switch; the client adds `ide` and `theme` |
| `pcbjs/segments` | request, client to server | `{ textDocument: { uri }, range?, position?, value? }` | the editable segments of the file, of a range, or the one at `position`; with `value`, that one segment with its presentation for writing `value` |

There is no apply message: the client applies a presentation's edit itself.

### Segments

`pcbjs/segments` answers `Segment[]`, in document order:

```text
interface Segment {
  range: Range                 // the value's text
  kind: SegmentKind            // the vocabulary below
  value: string                // the text as written
  label: string                // what it is, such as "J1 at" or "route path, command 2"
  constraints: { unit?, min?, max?, step?, choices?, grammar?, index? }
  presentations: { label: string; detail?: string; edit: TextEdit }[]
  widget?: Widget              // since 2
  error?: string               // set for a typed value that cannot be written; presentations is then empty
}
interface Widget {
  input: string                // number, length, angle, position, layer, enum, text or none; unknown means text
  typed: boolean               // whether a typed value goes to pcbjs/segments with value
  prompt?, options?, unit?, min?, max?, step?, preview?   // preview a CSS colour
}
```

A client renders the widget, not the kind, so a new kind needs only a server.

The server computes every edit. A typed value comes back as one presentation in the literal's own unit and grammar, or as `error`.

| Kind | Values, all since protocol 1 |
| --- | --- |
| `number` | a plain number such as `.impedance(90)` |
| `length` | `width`, `size`, `drill` and other length props, in the unit written |
| `angle` | the rotation of a position |
| `position` | an `at`, a route end or chain target, `x y [rot or layer]` |
| `layer` | a layer name or alias, the board's layers in `choices` |
| `enum` | a side, a copper count |
| `pathCommand` | one command of a path string, `grammar` `route` or `svg`, or one call of a route chain such as `.V(14)`, `grammar` `chain` |
| `pinRef` | the pad of a route end, `'U1.3'`, `J1[3]` or `U1.pad('6')`, or a helper's argument; presentations its part's other pads |

Without `widget`, a kind the client did not list reaches it as `enum` when it listed `enum`, else not at all.

## Fallback: the Vite-WS bridge

A dev server started by hand writes `<root>/.pcbjs/dev.json` while it listens, `{ port, host, urls, root, pid, startedAt, route, version, protocol, major }`, plus `scope` and `url` per scope of a workspace server. An editor watches for it, checks that `pid` lives, and connects to `ws://<host>:<port>/` with the subprotocol `vite-hmr` and no `Origin` header. An editor that hosts a server ignores the `dev.json` files under its folders.

Every message is Vite's envelope `{ "type": "custom", "event": <name>, "data": <payload> }`. A bridge sends `pcbjs:ide:hello`, `bye`, `cursor`, `focus` and `close` as in the hosted mode, with files absolute or relative to the root, and may run a language client through `pcbjs:lsp`. The server sends `pcbjs:cursor` `{ file, line, col, target? }` with the file relative to the root, `target` in highlight.md, `pcbjs:focus`, `pcbjs:scopes`, and `pcbjs:ide:select` to every bridge without a language client. A viewer in IDE mode sends `pcbjs:viewer:hello` and gets the last focus and cursor.

## Viewers on the socket

Viewers send `pcbjs:sync:hello` `{ board, focus? }`, `pcbjs:sync:hover` `{ board, hover }` and `pcbjs:sync:focus` `{ board, focus }`. The server relays both with `from` to the board's other viewers and answers a hello with the last focus unless `focus` is false. Payloads: viewer.md.

## HTTP endpoints

| Request | Reply |
| --- | --- |
| `POST /__pcbjs/cursor` with `{ file, line, col }` | broadcasts `pcbjs:cursor`, 204 |
| `GET /__pcbjs/open?file=&line=&col=&endLine=&endCol=&pad=&board=` | selects the range, or `pad`'s connect key, 204 with `x-pcbjs-opened`: `host` for the hosted editor, `ide` for bridges and Vite-socket language clients, `editor` for launch-editor's `file:line:col` |
| `GET /__pcbjs/ide` | `{ connected, clients: [{ name, version, protocol, major }], host }` |

`open` answers 400 without `file`, 404 for a file that is missing or that Vite may not serve. `GET /__pcbjs/<board>/board.json` is a board's site data in the scope shown; the VS Code sidebar reads it.

## Viewer page

A viewer in IDE mode loads `<url>?ide=1&theme=<dark|light|hc>`, plus `view=2d|3d|sch` for one fixed view without a header, and `panel=0` to hide the panel. The parent window may `postMessage` `{ type: "pcbjs:net", board?, net }` to pin a net, null to unpin, and `{ type: "pcbjs:finding", board?, at, layer? }` to pan 2D, or the schematic when `layer` is `sch`; `board` switches first.
