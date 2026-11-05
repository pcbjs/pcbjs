# Queries

What an agent asks a project: `pcbjs events` for what changed, `pcbjs q` for one reference's record, `pcbjs script` and `pcbjs repl` for code against the board API.
Advanced. Read it to wake on a finished check, look up a finding, a part or a route by its reference, or measure the board from code; session.md has the session they ask, refs.md the references.

```sh
pcbjs events                                   # { "next": "<cursor>" }: where to start
pcbjs events --since k3x9q2ab:41               # every event after the cursor, then the next cursor
pcbjs events --wait --for findings             # block until a check finishes; exit 124 after --timeout
pcbjs events --follow --scope 'CH2/*' --kind edit,findings
pcbjs q drc:clearance:7f3a0c1d2e4b             # one finding's evidence
pcbjs q CH2/R01/2                              # a pad, its part, net and findings
pcbjs script "board.parts({ prefix: 'C' }).map(c => [c.ref, board.distance(c, 'U1/VDD').d])"
pcbjs script --watch "board.findings({ severity: 'error' }).length"
```

## Events

The session keeps the last 10 000 events in memory. `events` needs a live session and exits 3 without one; it prints one JSON object per line.

```ts
import type { EventData, SessionEvent } from '@pcbjs/core/protocol'

type Edit = EventData['edit']
type Compile = EventData['compile']
type Selection = EventData['selection']
const sourceOf = (event: SessionEvent<'edit'>) => event.data.source
```

`SessionEvent` carries `id`, `t`, `kind`, `project`, `by` and `data`, narrowed by `kind`; `by` is the connection's `{ client, name, role?, task? }` or null. `EventData` declares every payload, including a selection's `board`, `refs`, `anchor`, `level` and `isolate`. Edit ranges use one-based lines and columns, end inclusive in the text before the edit.

- `id` is `<session>:<seq>`, gapless from 1, and the cursor `--since` takes; a snapshot is `<session>.<run>`, session.md. A cursor below the floor of what is kept, of another session or of another form, prints `{ "reset": "<reason>", "next": "<cursor>" }` first, then what is kept.
- `edit` is coalesced per file over 200 ms. A sync of an open document gives the changed range; a write on disk gives `ranges: null`. A write under a file an editor holds is `shadowed`, see session.md.
- `compile` is `{ state: 'started', run, tier, entries }` as a run begins and `{ state: 'cancelled', run }` when an edit stops it, then once the run mints a snapshot one event per stage of each board and target, `ok: false` with the entry for one that failed, or `{ state: 'held', file, line, snapshot }` when an edit holds the compile, editor.md. `findings` follows each board and target compile, an empty delta included, so it marks a finished check; `added` and `resolved` are finding ids, matched across the compile by fingerprint. Detail comes from `pcbjs q`.
- `selection`, from a viewer, and `cursor`, from an editor, keep their last value per 500 ms in the log.
- `message` is from the editor to one agent connection, `to` its client id, or an agent's task, plan and progress to `editor`; `delivered` follows once the agent read it, `returned` when it left unread. mcp.md has the delivery.
- A compile's events come after the edits it compiled.

| Flag | Prints | Exit |
| --- | --- | --- |
| none | `{ next }` | 0 |
| `--since <cursor>` | every event after it, then `{ next }` | 0 |
| `--wait [--for <kinds>] [--timeout <s>]` | the events after the cursor or now up to the first of the kinds, then `{ next }` | 0, or 124 after the timeout, 600 s by default |
| `--follow` | every event as it comes, until Ctrl-C or the session ends, then `{ end }` | 0 |
| `--kind <kinds>` | only these kinds, comma separated | |
| `--scope <pattern>...` | only events that touch the patterns | |

A harness told when a background command exits runs `--wait --for findings`, one that reads streams `--follow`, a turn-based one `--since` each turn with the stored `next`. All modes are `session/events { since, wait, for, timeout, follow, kind, scope }`; with `follow` the events arrive as `session/event` frames.

### Scopes

A scope is references of refs.md with `*` for any run within a segment, each also taking what sits under it, or file paths ending in a module extension: `CH2/*`, `TP2`, `net:VCC`, `route:*`, `drc:clearance:*`, `lib/fanout.tsx`. An `edit` touches the entities whose source ranges its changed ranges meet, a write on disk measured against the text the last compile read; a `save` the entities of its file; a `findings` delta its ids and their refs; `selection` its refs; `cursor` the entities under it. A part counts by its ref and its tree path, `R201` and `CH2/R01`. Every scope gets `compile` events.

### Who made an edit

`by` names the connection an event came through: an editor's document sync or save, an agent's sync or write. A write the watcher saw is claimed by `session/edited { file, name?, root? }`, which `pcbjs hook edited` sends after the harness's own file tools write, naming the agent connection of that harness name in that folder, so the event names that agent with `source: 'agent'` and its task; an unclaimed one has `by: null` and `source: 'disk'`. Once any claim came in, or `pcbjs hook prompt` said its harness claims, an unclaimed write waits up to 2 s for its claim before it is logged, even past a compile. A prompt that explicitly enables hook claims allows up to 10 s for a spawned post-tool hook to start; an arriving claim logs the edit immediately. An editor's own save is a `save`, never an `edit`.

### Demand

An edit compiles only while something observes its project: a viewer of it, or, for the scope shown last, workspace.md, an editor or language client, `pcbjs dev`, a subscriber of `findings` or `compile`, or a `--wait` for them while it waits. A subscriber of `edit`, `save`, `selection` or `cursor` alone observes nothing, since the watcher makes those without a compile. With no observer an edit is logged and waits; the next query or observer compiles it, as every query settles first, session.md. An edit a query already compiled is not compiled again when its watcher event comes after.

## q

`pcbjs q <reference> [--board <name>] [--target <name>] [--timeout <s>]` prints the reference's record in its snapshot's envelope, `{ snapshot, stale, overlay, value }`. The grammar gives the kind, so `q R1`, `q CH2/R01/2`, `q net:VCC`, `q route:3`, `q route:vccTrunk/pt:2`, `q item:9c1e…`, `q drc:clearance:7f3a…` all work. `board:<name>/` or `--board` picks the board; a reference several boards or paths answer exits 2 with `value.candidates`, listed on stderr too; one that names nothing exits 1. A part ref, net or finding id of an older snapshot answers as the current snapshot names it, with `stale: { reason: 'changed', current }`; one whose source call is gone answers `reason: 'gone'` with the nearest names.

```ts
import type { NetRecord, PartRecord, RouteRecord } from '@pcbjs/compile/query'

const show = (p: PartRecord, n: NetRecord, r: RouteRecord) => [p.pads.map(x => x.net), n.routes, r.points.map(x => x.ref)]
```

A record is complete for what it names and gives nested things as references, so more detail is one more `q`: a part its pad records, bbox, courtyard, model, findings and source range; a pad its uid, number, name, net, layers, size and drill in board axes; a net its class, pads, routes, vias, pours, length and source ranges; a route its pair, ends, layers, width, length, target `{ min, max }` narrowed by its match group, skew, tuning, optional `note` and `skewNote` explaining stopped tuning, status of `ok`, `short`, `long`, `failed` or `unrouted`, vias, points and helper call site; an item its uid as `ref`, compile `id`, type, layers, net and geometry; a finding the evidence of findings.md. Millimetres to 0.1 µm and degrees; every record carries its `kind`, `q` adds the `board` and `target`, and `inspect --json` prints the same records.

## script and repl

`pcbjs script <code> [--board] [--target] [--timeout <ms>]`, `-` reading stdin, runs TypeScript statements whose last expression is the value. A string prints raw, `undefined` nothing, anything else as JSON. An exception prints `script:<line>: <message>` and exits 1; running past the timeout, 2000 ms by default and 30 000 at most, exits 124. The code sees `board`, the board of `--board` or the first, `boards`, one per board, and `snapshot`, with ECMAScript's globals only: no `require`, `import`, `process`, timers or `fetch`, no code from strings, and a returned promise is an error.

`pcbjs script --watch <expr> [--scope <pattern>...]` evaluates the expression after each compile of the session and prints it when its value changed, the standing query; `--scope` evaluates only after findings that touch the scope. It needs a live session, exit 3 without one.

`pcbjs repl` is a prompt of scripts. In a session its bindings persist and `board` follows the newest snapshot, saying `board now at snapshot …` when it moved; without one it compiles once and `.refresh` compiles again. `script` and `repl` need a read-write connection, since `vm` is no security boundary.

## The board API

`@pcbjs/compile/query` is the API of `script`, `repl`, `q` and `pcbjs test`, testing.md: frozen views over one compiled board whose fields are their record and whose `toJSON` is it. Layers are ids, `F.Cu`, never aliases.

```ts
import type { Board, Entity, ItemKind, ItemView, Net, Part, Point, Route, FindingView } from '@pcbjs/compile/query'
type Target = string | Entity | Point // a reference, a view or a point in mm

interface BoardApi {
  readonly name: string; readonly target: string | null; readonly snapshot: string; readonly rev?: string
  part(ref: string): Part | null
  parts(filter?: { group?: string; prefix?: string; side?: 'F' | 'B' }): Part[]
  net(name: string): Net | null
  nets(): Net[]
  finding(id: string): FindingView | null
  findings(filter?: { rule?: string; severity?: string; ref?: string }): FindingView[]
  route(ref: string): Route | null
  routes(): Route[]
  resolve(reference: string): Entity | null // several matches throw, naming each
  items: { near(at: Target, r: number, o?: { layer?: string; kinds?: ItemKind[] }): ItemView[]; on(layer: string, o?: { net?: string; kinds?: ItemKind[] }): ItemView[] }
  distance(a: Target, b: Target, o?: { layer?: string }): { d: number; a: Point; b: Point }
  clearance(a: Target, b: Target): { actual: number; required: number; rule: string; from: string }
  bbox(t: Target): { x: number; y: number; w: number; h: number }
  source(t: Target): { file: string; line: number; col: number; endLine: number; endCol: number }[]
  rulesAt(at: Point, layer: string, net?: string): Record<string, number | string>
}
const same = (b: Board): BoardApi => b
```

- `distance` is edge to edge between copper or ink, 0 when they touch: a part measures by its pads, a net by its copper, a route by its tracks and vias, a finding by its point. `clearance` takes the nearest two items and gives the clearance that holds between them and the level it came from, `rules`, `class <name>`, `pad` or `part`.
- `items.near` lists the items within `r` of the target, the target's own left out; `items.on` the items on a layer, a layer pair `F.Cu..B.Cu` giving the vias of that span, with the layer's keepouts. `ItemKind` is `pad`, `track`, `arc`, `via`, `zone`, `keepout`, `text` or `drawing`.
- `rulesAt` gives the class, clearance, track width, via drill and size, hole and edge clearance, the copper weight when the stackup has one, a class's gap and impedance, and the keepout over the point.

Route status `short` means below the length target; human inspection prints “below length target”. It does not denote an electrical short. `rulesAt()` reports board/class preferred `viaDrill` and `viaSize`, with `minViaDrill`, `minViaDiameter` and `minAnnularRing` kept separate. The default without a class matches standalone via emission. A point and net do not identify a route: board/class autoroute settings, route overrides and chain exceptions can change its physical dimensions, so inspect actual via items for a fabrication inventory.
