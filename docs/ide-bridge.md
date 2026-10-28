# IDE bridge

The protocol between pcbjs dev and an editor: the hosted socket, versions, the language server and its segments, the Vite-WS fallback and the HTTP endpoints.
Read it to write a client for another editor; editor.md has the VS Code extension as a user sees it.

```text
editor listens   ws://127.0.0.1:<random port>/<random token>
editor spawns    <dir>/node_modules/.bin/pcbjs dev --workspace <folder>... --ide=<url> --port 0 --host 127.0.0.1
editor -> server {"event":"pcbjs:ide:hello","data":{"name":"ed","version":"1.0.0","protocol":2,"major":1,"capabilities":["lsp","widget"]}}
server -> editor {"event":"pcbjs:ide:ready","data":{"port":51234,"pid":4242,"protocol":2,"major":1,…}}
```

## Hosted mode

- The editor answers other paths 403 and pings every 15 s. `<dir>` is the nearest folder with pcbjs installed, else a global `pcbjs`; spawn with `NO_COLOR=1`; stop with SIGTERM, SIGKILL after 3 s.
- The server reconnects with backoff from 0.5 s doubling to 10 s. `--ide` takes ws or wss on `127.0.0.1`, `localhost` or `[::1]`, any host with `--ide-allow-remote`.
- A frame is one JSON object: an event `{ "event": <name>, "data": <payload> }` or JSON-RPC 2.0, told apart by `jsonrpc`. Unknown events, fields and capabilities are ignored.

| Event | Direction | Payload | Meaning |
| --- | --- | --- | --- |
| `pcbjs:ide:hello` | to server | `{ name, version, protocol, major, capabilities }` | first frame |
| `pcbjs:ide:ready` | to editor | `{ port, host, urls, root, pid, version, folders?, protocol, major, capabilities }` | listening, each reconnect |
| `pcbjs:ide:scopes` | to editor | `{ scopes: [{ slug, name, dir, root, route, status, stale, displayed, error, boards }], displayed, single }` | after each load, compile or switch |
| `pcbjs:ide:scope` | to editor | `{ scope, root, route, url }` | the displayed scope changed |
| `pcbjs:ide:boards` | to editor | `{ boards: [{ name, title, entry, targets, status, draft?, skipped? }], single, errors, scope?, root? }` | each compile; `status` `ok`, `error` or `incomplete`; `draft` from unsaved text |
| `pcbjs:ide:log` | to editor | `{ level, text }` | each `[pcbjs]` log line |
| `pcbjs:ide:select` | to editor | `{ file, line, col, endLine, endCol }` | select and reveal, without a language client |
| `pcbjs:ide:cursor` | to server | `{ file, line, col }` | the cursor, without a language client |
| `pcbjs:ide:focus` | to server | `{ file }` | the active file, likewise |
| `pcbjs:ide:close` | to server | `{ file }` | drop its isolated preview |
| `pcbjs:ide:bye` | to server | none | editor leaving |

Files are absolute, lines and columns 1-based, `endCol` inclusive. A reconnect resends the last `ready`, `scopes`, `scope` and `boards`; match the server by `pid` or `root`.

A focus becomes `pcbjs:focus` for viewers, `{ board, entry, boards, file, scope? }`: the first live board whose entry imports the file, else an isolated preview; another scope's file switches scope first.

## Versions

- `protocol`, `major` and `capabilities` go in `hello`, `ready` and `initialize`; absent means protocol 1, major 1, all of protocol 1. `protocol` only adds; a server answers every protocol up to its own.
- A new `major` breaks older peers: the extension shows one notice and the server warns, both naming `pcbjs ide install`.
- Capabilities are the events a side takes, plus `lsp` and `widget` for an editor, `lsp` for a server with @pcbjs/lsp; start no language client without it.

| Protocol | Major | pcbjs | What changed |
| --- | --- | --- | --- |
| 1 | 1 | 0.0.x | the events, the language server and the segment kinds |
| 2 | 1 | 0.1.x | `protocol`, `major` and `capabilities` on `hello`, `ready`, `initialize` and `dev.json`; `widget` on segments |

The extension's `version` tracks its `@pcbjs/pcbjs` major and minor; a patch changes no protocol.

## Language server

`@pcbjs/lsp` loads on the first `initialize`; without it `initialize` fails and events still work. JSON-RPC is its own frame on the hosted socket, the payload of `pcbjs:lsp` on Vite's; one session per connection.

- `initialize` may carry `initializationOptions.pcbjs`, `{ protocol, major, kinds, capabilities, name, version }`, `kinds` defaulting to all of its version; without it, standard methods only.
- The answer's `capabilities.experimental.pcbjs`, `{ protocol, major, kinds, capabilities, methods, version }`, holds the lower protocol and what the server honours. A `widget` client gets every kind.
- Full document sync and saves; a document unlike its file compiles as a draft. Positions are LSP's: 0-based lines, UTF-16 characters.

| Method | Answers |
| --- | --- |
| `textDocument/documentHighlight` | the innermost range that drew items, and ranges that drew the same items or parts |
| `textDocument/hover` | preview, value, what it drew, route length, target and skew, findings |
| `textDocument/definition` | placement to footprint definition and back, pad reference to placement, each instance's in a layout |
| `textDocument/codeLens` | route length, target, group, skew; a helper call's routes; a layout part's instances; a call's findings; empty commands |
| `textDocument/inlayHint` | pad nets, `net GND` or `nets A/sl, B/sl`; rule widths, `width 0.2 mm` |
| `textDocument/publishDiagnostics` | every board and target's findings, `source` `pcbjs DRC` or `pcbjs ERC`, `code` the rule; draft spans as Unnecessary hints, `source` `pcbjs draft` |

After a compile it sends `workspace/codeLens/refresh` and `workspace/inlayHint/refresh` when supported. A hover is one markdown `MarkupContent`, with a preview first as `![<kind> on <board>](data:image/svg+xml;base64,…)` and a blank line: `kind` is `placement`, `items`, `pad`, `net`, `keepout`, `footprint`, `model`, `group`, `point` or `reference`, the SVG 360 px wide, at most 198 high, `data-box` the crop `x y w h` in mm. A layout placed twice answers `Q1 (A/QH) · Q3 (B/QH)`.

| Method | Kind | Params | Meaning |
| --- | --- | --- | --- |
| `pcbjs/focus` | client to server | `{ textDocument: { uri }, position, selection? }` | focus and cursor; switches board or scope, highlights in viewers |
| `pcbjs/select` | server to client | `{ uri, range }` | a viewer click: select and reveal |
| `pcbjs/preview` | server to client | `{ url, scope? }` | the page to show, after the handshake and each scope switch; the client adds `ide` and `theme` |
| `pcbjs/segments` | request | `{ textDocument: { uri }, range?, position?, value? }` | editable segments of the file, a range or `position`; with `value`, that segment's presentation for it |

### Segments

No apply message: the server computes every edit, the client applies it. A typed value returns as one presentation in the literal's unit and grammar, or `error`.

```text
interface Segment {
  range: Range                 // the value's text
  kind: SegmentKind
  value: string                // as written
  label: string                // such as "J1 at" or "route path, command 2"
  constraints: { unit?, min?, max?, step?, choices?, grammar?, index? }
  presentations: { label: string; detail?: string; edit: TextEdit }[]
  widget?: Widget              // since 2
  error?: string               // a typed value that cannot be written; presentations empty
}
interface Widget {
  input: string                // number, length, angle, position, layer, enum, text or none; unknown means text
  typed: boolean               // a typed value goes to pcbjs/segments with value
  prompt?, options?, unit?, min?, max?, step?, preview?   // preview a CSS colour
}
```

| Kind | Values, all since protocol 1 |
| --- | --- |
| `number` | a plain number, `.impedance(90)` |
| `length` | `width`, `size`, `drill` and other lengths, in the unit written |
| `angle` | the rotation of a position |
| `position` | `at`, a route end or chain target, `x y [rot or layer]` |
| `layer` | a layer name or alias, the board's layers in `choices` |
| `enum` | a side, a copper count |
| `pathCommand` | one path command, `grammar` `route` or `svg`, or one chain call such as `.V(14)`, `grammar` `chain` |
| `pinRef` | the pad of a route end, `'U1.3'`, `J1[3]` or `U1.pad('6')`, or a helper's argument; presentations its part's other pads |

A client renders the widget, not the kind. Without `widget`, an unlisted kind arrives as `enum` when it listed `enum`, else not at all.

## Fallback: the Vite-WS bridge

- A hand-started server writes `<root>/.pcbjs/dev.json`, `{ port, host, urls, root, pid, startedAt, route, version, protocol, major }`, plus `scope` and `url` per workspace scope; a hosting editor ignores it. Check `pid` lives, then connect to `ws://<host>:<port>/` with subprotocol `vite-hmr` and no `Origin`.
- Messages are `{ "type": "custom", "event": <name>, "data": <payload> }`. A bridge sends `pcbjs:ide:hello`, `bye`, `cursor`, `focus` and `close`, files absolute or root-relative, and may run a language client through `pcbjs:lsp`.
- The server sends `pcbjs:cursor` `{ file, line, col, target? }`, root-relative, `target` in highlight.md; `pcbjs:focus`; `pcbjs:scopes`; and `pcbjs:ide:select` to bridges without a language client. An IDE mode viewer sends `pcbjs:viewer:hello` and gets the last focus and cursor.
- Viewers send `pcbjs:sync:hello` `{ board, focus? }`, `pcbjs:sync:hover` `{ board, hover }` and `pcbjs:sync:focus` `{ board, focus }`, relayed with `from` to the board's other viewers; hello gets the last focus unless `focus` is false. Payloads in viewer.md.

## HTTP endpoints

| Request | Reply |
| --- | --- |
| `POST /__pcbjs/cursor` with `{ file, line, col }` | broadcasts `pcbjs:cursor`, 204 |
| `GET /__pcbjs/open?file=&line=&col=&endLine=&endCol=&pad=&board=` | selects the range or `pad`'s connect key; 204 with `x-pcbjs-opened` `host`, `ide` for bridges and Vite-socket language clients, or `editor` for launch-editor's `file:line:col`; 400 without `file`, 404 for a file Vite may not serve |
| `GET /__pcbjs/ide` | `{ connected, clients: [{ name, version, protocol, major }], host }` |
| `GET /__pcbjs/<board>/board.json` | site data of the shown scope, read by the VS Code sidebar |

## Viewer page

`<url>?ide=1&theme=<dark|light|hc>`, `view=2d|3d|sch` for one view without a header, `panel=0` to hide the panel. The parent may `postMessage` `{ type: "pcbjs:net", board?, net }` to pin a net, null to unpin, and `{ type: "pcbjs:finding", board?, at, layer? }` to pan 2D, or the schematic when `layer` is `sch`; `board` switches first.
