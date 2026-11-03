// The session and IDE protocol, declared once: the version and compat, the `session/*` methods, the events each side sends, the frames
// the session, the viewers, the extension and the language server share. Types and constants only; docs/ide-bridge.md has the transports.
import type { Capability, DrcMarker, Pt } from './model.js'
import type { Selection } from './selection.js'
import type { FacetName, FacetOut, FacetSet, ViewName } from './site-facets.js'

/** Additive: a peer answers a newer one with its own. */
export const PROTOCOL = 6
/** Bumped only by a change an older peer cannot survive. */
export const MAJOR = 1

/** One compile of a session, counted from 1 across its projects; facets and invalidates name the run that made them. */
export type Run = number
/** A snapshot is the run that committed it: `<session>.<run>`. */
export type SnapshotId = `${string}.${number}`
export const snapshotId = (session: string, run: Run): SnapshotId => `${session}.${run}`
/** The session and run of a snapshot id, null for anything else. */
export function parseSnapshot(id: string): { session: string; run: Run } | null {
  const m = /^(.+)\.(\d+)$/.exec(id)
  return m ? { session: m[1], run: Number(m[2]) } : null
}
/** Two snapshots of one session in the order they committed; none goes first. */
export const snapshotOrder = (a: string | null | undefined, b: string | null | undefined): number => (parseSnapshot(a ?? '')?.run ?? -1) - (parseSnapshot(b ?? '')?.run ?? -1)
/** An events log cursor: `<session>:<seq>`, never confused with a snapshot id. */
export type Cursor = `${string}:${number}`
export const cursorOf = (session: string, seq: number): Cursor => `${session}:${seq}`
/** The session and sequence number of a cursor, null for anything else. */
export function parseCursor(c: string): { session: string; seq: number } | null {
  const m = /^(.+):(\d+)$/.exec(c)
  return m ? { session: m[1], seq: Number(m[2]) } : null
}

/** A peer against this side: the same protocol, an older or newer one of the same major, or another major or none at all. */
export type Compat = 'same' | 'older' | 'newer' | 'incompatible'
export function compat(peer: { protocol?: unknown; major?: unknown } | null | undefined): Compat {
  if (!peer || !Number.isInteger(peer.protocol) || !Number.isInteger(peer.major) || peer.major !== MAJOR) return 'incompatible'
  const p = peer.protocol as number
  return p === PROTOCOL ? 'same' : p < PROTOCOL ? 'older' : 'newer'
}

export type Role = 'editor' | 'agent' | 'viewer' | 'cli'
/** What a connection may do: write, or only read. */
export type Mode = 'rw' | 'ro'

/** `pcbjs:ide:hello`, the first frame of every session connection. */
export interface Hello {
  name: string
  version: string
  protocol: number
  major: number
  capabilities: string[]
  role?: Role
  /** the root the connection's requests default to; a project not served yet is attached */
  project?: string
  token?: string
}

/** `pcbjs:ide:ready`: where the session listens and what it speaks. */
export interface ReadyInfo {
  port: number
  host: string
  urls: string[]
  root: string
  pid: number
  version: string
  /** a workspace server's folders, `root` first */
  folders?: string[]
  protocol: number
  major: number
  capabilities: string[]
  /** the session's id */
  session?: string
}
/** The ready a connection gets: its mode and every project the session serves, with its page. */
export interface Ready extends ReadyInfo {
  session: string
  mode: Mode
  projects: { root: string; slug: string; url: string }[]
}

/** Who a frame came through: a connection's id, its hello's name and role; `task` arrives with session/describe. */
export interface By {
  client: string
  name: string
  role?: Role
  task?: string
}

// --- edits

export type ToolId = 'move' | 'rotate' | 'layer' | 'point' | 'assist'
export interface Tool {
  id: ToolId
  needs: Capability
  key: 'M' | 'R' | 'L' | 'P'
}
/** The tools and the capability each needs, as the session declares them. */
export const TOOLS: readonly Tool[] = [
  { id: 'move', needs: 'placed', key: 'M' },
  { id: 'rotate', needs: 'placed', key: 'R' },
  { id: 'layer', needs: 'layered', key: 'L' },
  { id: 'point', needs: 'chain', key: 'P' },
]

export interface EditBegin {
  board: string
  target?: string | null
  /** the run the viewer drew; a begin against another snapshot is refused */
  run?: Run | null
  tool: ToolId
  refs: string[]
  anchor: string
  /** the instance whose definition the view isolates, `CH1`: every write goes to the definition, which all its instances follow */
  isolate?: string | null
}
export interface EditUpdate {
  /** Persist the placement editing pitch in its grid attribute, in mm. */
  grid?: number
  /** Rewrite a literal trace primitive, preserving its endpoint when only case changes. */
  command?: 'H' | 'h' | 'V' | 'v' | 'L' | 'l' | 'A' | 'a' | 'X' | 'Z'
  /** Copper layer for the selected trace primitive. */
  layer?: string
  /** board mm */
  delta?: Pt
  /** degrees, counter-clockwise on screen */
  angle?: number
  side?: 'F' | 'B'
  /** a control point's new place in board mm, or an automatic leg's new waypoint */
  point?: { at: Pt }
  /** the control point `pt:k` is deleted with its call */
  remove?: boolean
  /** a control point is inserted at `point` after `pt:k` */
  insert?: boolean
  /** cmd or ctrl lifted snapping: positions under a grid are written in explicit mm */
  free?: boolean
  /** an assist pick with shift: `l` when its straight trace is clean, else `X` */
  pick?: boolean
  /** a route end pick: the candidate's handle, `J1[2]` */
  end?: string
}

export interface Position {
  line: number
  character: number
}
export interface Range {
  start: Position
  end: Position
}
export interface TextEdit {
  range: Range
  newText: string
}
/** The editor text an edit was computed on: the connection that held it and that text's version. */
export interface Against {
  holder: string
  version: number
}
export interface FileEdits {
  file: string
  edits: TextEdit[]
  /** a file that does not exist yet, made with the edits applied to no text */
  create?: true
  /** an editor's text the edits were computed on, which the editor refuses them for once its text moved on */
  against?: Against
}

/** An assist pick's trace in board mm, with the clearance it breaks. */
export interface AssistPreview {
  /** the command the pick writes, the context's unless shift chose `l` or `X` */
  command: string
  tracks: { layer: string; pts: Pt[] }[]
  vias: Pt[]
  /** each clearance the trace breaks, `clearance: 0.08 mm to pad R2/1 (GND) on F.Cu, needs 0.2 mm` */
  findings: string[]
  /** why the router found no leg, for X */
  error?: string
  ms: number
}
export interface EditPlan {
  txn: string
  files: FileEdits[]
  notes: string[]
  findings: string[]
  preview: AssistPreview | null
}
export interface Written {
  file: string
  via: 'editor' | 'disk'
  applied: boolean
  /** why an edit was not applied */
  reason?: string
}
export interface EditResult {
  /** absent for a pick the viewer cancelled with nothing to write */
  txn?: string | null
  written: Written[]
  error?: string
  /** where an assist pick leaves the editor cursor, 1-based */
  cursor?: { file: string; line: number; col: number }
}

// --- the assist context

/** The ends a route slot can take. */
export interface EndSlot {
  slot: number
  /** a pick writes `, <handle>` after the end the cursor ends */
  append: boolean
  /** the first end's net, the only one its candidates are on; null in the first slot, where every terminal with an open ratsnest line is one */
  net: string | null
  candidates: EndCandidate[]
  /** why ends are left out: `CH2 is not in scope here` */
  notes?: string[]
}
/** One possible route end: a pad, or a point of a bound route. */
export interface EndCandidate {
  /** what a pick writes, through the identifier in scope that holds the part or instance: `J1[2]`, `ch2.R[1]` or `ch2.vccTrunk.end` */
  handle: string
  /** pin number, pin name when it differs, and net: `2 · VCC`, `1 B · SIG`; a point's name and net: `end · VCC` */
  label: string
  kind: 'pad' | 'point'
  /** the reference: `J1/2`, `route:vccTrunk/pt:3` */
  ref: string
  num?: string
  name?: string
  net: string | null
  at: Pt
  side: 'F' | 'B'
}
/** What the viewer needs to offer the dots of one spot on one board, as the language server resolves it and `pcbjs:assist` carries it. */
export interface AssistContext {
  board: string
  command: string
  /** a lower-case chain command writes its argument relative to the start */
  relative: boolean
  /** the route, `route:3`, or the placed part; null when the board has none yet */
  ref: string | null
  /** where the next segment starts, board mm; null for an `at` */
  start: Pt | null
  /** the pad the chain starts on, `J1/1`, when the start is the first end */
  pad: string | null
  layer: string | null
  net: string | null
  side: 'F' | 'B' | null
  /** the grid in effect, by name */
  grid: string | null
  /** track width, mm */
  width: number | null
  /** the numbers typed so far, mm */
  typed: number[]
  /** the file, absolute, and the spot's offsets in the editor's text */
  file: string
  start0: number
  end0: number
  name0: number
  open: boolean
  /** a route end slot: the ends the netlist leaves open from it */
  ends?: EndSlot
}

// --- the live board

/** One stage in `pcbjs:status`: stale until it runs in this compile, `units` done of total within it, legs for autoroute and zones for finish. */
export interface StageState {
  name: string
  state: 'stale' | 'running' | 'done' | 'hit'
  ms: number
  units?: [number, number]
}
/** `pcbjs:status`: the compile the server runs, `starting` before the first; `done` of `total` entries before this one, `routed` of `legs` in the router's first pass or negotiation `round`; `stages` those its views need, under the run it streams. */
export type LoadStatus =
  | { phase: 'starting' | 'idle' | 'cancelled'; run?: Run; stages?: StageState[] }
  | {
      phase: 'compiling' | 'routing'
      entry: string
      name: string | null
      done: number
      total: number
      routed?: number
      legs?: number
      round?: number
      run: Run
      stages: StageState[]
    }

/** `pcbjs:facet`: one facet of one board target, of the run that made it. */
export interface FacetMsg extends FacetOut {
  run: Run
  /** the keystroke tier's layers and shapes of the edited entity alone, drawn in place of the items it `replaces`, by uid */
  partial?: { replaces: string[] }
}
/** `pcbjs:invalidate`: the parts, nets as `net:<name>`, items by uid and findings by id an edit makes stale in the snapshot of `run`; every facet of a run up to `edit` is stale. */
export interface Invalidate {
  board: string
  target?: string
  run: Run
  refs: string[]
  uids: string[]
  findings: string[]
  edit?: Run
}
/** `session/state`, the heartbeat: the run of the session's snapshot and the hash of each facet, `<facet>:<board>` or `<facet>:<board>|<target>`. */
export interface StateMsg {
  project: string
  run: Run | null
  facets: Record<string, string>
  /** a compile runs or waits */
  pending: boolean
  /** an editor's draft holds its compile while its block has an error */
  hold: { file: string; line: number } | null
  tiers: Tiers
}
/** A tier of an edit, docs/session.md: the keystroke tier's sketch, the compile after the quiet period, and a query's compile of every view. */
export type TierName = 'keystroke' | 'quiet' | 'query'
/** One step of a project's compile as the session runs it; `pcbjs:status`, the heartbeats, the events log, the LSP refresh and the dev log are projections of this stream. */
export type CompileEvent =
  | { t: 'requested'; project: string; run: Run; tier: TierName; entries: string[]; cause: string[] }
  | { t: 'started'; project: string; run: Run; entry: string; name: string | null; done: number; total: number; stages: string[] }
  /** `units` done of total within the stage, legs for autoroute with the negotiation `round` */
  | { t: 'stage'; project: string; run: Run; entry: string; stage: string; state: 'running' | 'done' | 'hit'; ms: number; units?: [number, number]; round?: number }
  | { t: 'facet'; project: string; facet: FacetMsg }
  | { t: 'failed'; project: string; run: Run; entry: string; name: string | null; message: string; stack: string; text: string }
  | { t: 'cancelled'; project: string; run: Run; entries: string[] }
  /** the run's boards are the project's now; `snapshot` the one it minted, null for a run of the views shown alone, whose `partial` entries compile the rest when a view or a query needs it */
  | { t: 'committed'; project: string; run: Run; snapshot: string | null; entries: string[]; partial: string[] }
  /** an editor's draft began or stopped holding the compile, `line` 1-based, null when the hold ended */
  | { t: 'held'; project: string; file: string; line: number | null }
/** The keystroke tier's pause and the quiet period before the full compile, ms. */
export interface Tiers {
  keystroke: number
  quiet: number
}

/** What a page shows: a board, its target, the facets its view needs, and in a workspace of several scopes the slug of its scope. */
export interface Observe {
  board: string | null
  target: string | null
  scope?: string
  facets: FacetName[]
}
/** Why a page asks for everything again. */
export type Condition = 'seq' | 'hash' | 'behind' | 'unknown'
export interface Desync {
  condition: Condition
  board?: string
  target?: string | null
  run?: Run | null
  expected?: number
  got?: number
  facet?: string
}
/** `session/observe`: what a page shows, the hashes it holds of that board, and `select: false` to keep its own selection of a board it switched to. */
export type ObserveParams = Observe & { held?: Record<string, string>; select?: boolean }
/** `session/resync`: a view out of sync, what it holds and its last minute of frames. */
export type ResyncParams = Omit<Desync, 'board' | 'target'> & { board: string | null; target: string | null; held: Record<string, string>; timeline: unknown[] }

/** `pcbjs:boards`: the boards of the shown project as facets; `transient`, an isolated preview, goes last. */
export interface BoardsMsg {
  boards: FacetSet[]
  single: boolean
  /** by entry path, in entry order */
  errors: Record<string, string | null>
  /** by board name */
  entries?: Record<string, string>
  scope?: string
  /** the run of the snapshot the boards are from; a board held at a newer one keeps what its facets drew */
  run?: Run | null
}

/** One project of a workspace, as `pcbjs:scopes` and `pcbjs:ide:scopes` list it. */
export interface ScopeSummary {
  slug: string
  /** the directory's name */
  name: string
  /** the config directory relative to its workspace folder, '.' for the folder itself */
  dir: string
  /** the config directory, absolute */
  root: string
  route: string
  status: 'unloaded' | 'ok' | 'incomplete' | 'error'
  stale: boolean
  displayed: boolean
  error: string | null
  boards: { name: string; title: string; entry: string; status: string }[]
}
/** `pcbjs:scopes` and `pcbjs:ide:scopes`; `displayed` is the scope HMR follows. */
export interface ScopesMsg {
  scopes: ScopeSummary[]
  displayed: string | null
  single: boolean
}
/** `pcbjs:ide:scope`: the displayed scope changed. */
export interface ScopeMsg {
  scope: string
  root: string
  route: string
  /** null before the server listens */
  url: string | null
}
/** A board as `pcbjs:ide:boards` lists it; `error` marks a last good board, `incomplete` DRC errors or unconnected nets. */
export interface IdeBoard {
  name: string
  title: string
  entry: string
  targets: string[]
  status: 'ok' | 'error' | 'incomplete'
  draft?: true
  skipped?: number
}
export interface IdeBoardsMsg {
  boards: IdeBoard[]
  single: boolean
  errors: Record<string, string | null>
  scope?: string
  /** the directory entries are relative to */
  root?: string
}
export interface LogMsg {
  level: string
  text: string
}

/** `pcbjs:focus`: the editor's focus resolved; `boards` import the file; `isolated` is the preview of a file no board imports, named `preview:<file>`. */
export interface FocusEvent {
  board: string | null
  entry: string | null
  boards?: string[]
  file: string
  isolated?: boolean
  scope?: string
}

/** A hover as it travels: item uids, the parts of a body, symbol or sheet, and its net. */
export interface HoverWire {
  uids: string[]
  refs: string[]
  net: string | null
}
/** `session/hover` and `pcbjs:sync:hover`; the session adds `from`, the sender's client id, to what it relays. */
export interface HoverMsg {
  board: string
  hover: HoverWire | null
  from?: string
}
/** `pcbjs:select`: the selection of a board, stamped `seq` by the session, to every viewer of the board. */
export interface SelectMsg {
  board: string
  selection: Selection
}

/** A viewer's tools: `rw` from its ready lets it write; `editor` from `pcbjs:editor` says one is attached, so writes go through it rather than to disk. */
export interface EditModeMsg {
  mode: Mode
  editor: boolean
}

/** An agent attached to the session, as a page lists it. */
export interface AgentInfo {
  client: string
  name: string
  since?: string
  task?: string
  root?: string
}
/** What a page's chip asks an agent to look at. */
export interface SendRequest {
  board: string
  target: string | null
  refs: string[]
}
/** `session/send`: a note to an agent, the only one attached when `to` is left out. */
export interface SendParams {
  to?: string
  comment?: string
  board?: string
  target?: string | null
  snapshot?: string
  refs?: string[]
  ranges?: SourceSpan[]
  finding?: string
}

// --- the events log

export type EventKind = 'edit' | 'save' | 'compile' | 'findings' | 'selection' | 'cursor' | 'message' | 'delivered'
export const EVENT_KINDS: readonly EventKind[] = ['edit', 'save', 'compile', 'findings', 'selection', 'cursor', 'message', 'delivered']

/** A source range as an editor selection names it, 1-based. */
export interface SourceSpan {
  file: string
  line: number
  col: number
  endLine: number
  endCol: number
}
/** To an agent's connection, or from an agent to `editor`: what the human sent, or the agent's task, plan and progress. */
export interface Message {
  /** a client id, or `editor` */
  to: string
  /** `editor`, or the agent's client id */
  from: string
  refs?: string[]
  ranges?: SourceSpan[]
  finding?: string
  comment?: string
  board?: string
  target?: string | null
  snapshot?: string
  task?: string
  plan?: string[]
  progress?: string
}
/** 1-based line and column, end inclusive, in the text before the edit. */
export interface EditRange {
  start: [number, number]
  end: [number, number]
}
export interface EventData {
  edit: { file: string; source: 'editor' | 'agent' | 'disk'; ranges: EditRange[] | null; shadowed?: true }
  save: { file: string }
  /** a run started or an edit cancelled it, a stage done once its run minted a snapshot, or the compile of an edit held while its block has an error, `line` 1-based */
  compile:
    | { state: 'started'; run: Run; tier: TierName; entries: string[] }
    | { state: 'cancelled'; run: Run }
    | { snapshot: string; stage: string; board?: string; target?: string | null; entry?: string; ok: boolean; ms: number; cached: boolean }
    | { state: 'held'; file: string; line: number; snapshot: string | null }
  findings: {
    snapshot: string
    board: string
    target: string | null
    added: string[]
    resolved: string[]
    errors: number
    warnings: number
    unconnected: number
    drc: { errors: number; warnings: number }
    erc: { errors: number; warnings: number }
  }
  /** a board's selection: its members in joining order, the anchor, the entered level and the isolated instance */
  selection: { board: string; refs: string[]; anchor: string | null; level: string | null; isolate: string | null }
  cursor: { file: string; line: number; col: number }
  message: Message
  /** the agent read the message, or it went back to its sender when the agent left unread */
  delivered: { message: string; to: string; returned?: true }
}
/** One event of the log; a union by kind, so a test of `kind` narrows `data`. */
export type SessionEvent<K extends EventKind = EventKind> = {
  [P in K]: { id: string; t: number; kind: P; project: string; by: By | null; data: EventData[P] }
}[K]
/** The events after a cursor; `reset` when the cursor was of another session or below the floor. */
export interface EventsPage {
  events: SessionEvent[]
  next: string
  reset?: string
  timeout?: true
}

// --- queries

export interface Stale {
  reason: 'changed' | 'compiling' | 'failed' | 'timeout' | 'gone'
  /** the reference in the current snapshot that an older one became */
  current?: string
}
/** A query's answer on a snapshot. */
export interface Envelope<T> {
  snapshot: string
  stale: Stale | null
  /** the files whose unsaved text the snapshot compiled, relative to the project */
  overlay: string[]
  value: T
}
/** A command's output as the session ran it. */
export interface Ran {
  stdout: string
  stderr?: string
  exitCode: number
}
/** `pcbjs script` and `repl`: the value printed or the error. */
export type ScriptResult = { exit: 0; output: string | null; moved?: boolean } | { exit: 1 | 124; error: string; moved?: boolean }
/** A connection as `session/clients` and `session/status` list it. */
export interface ClientInfo extends By {
  kind: 'socket' | 'tcp'
  mode: Mode
  version?: string | null
  since?: string
  root?: string
  plan?: string[]
  progress?: string
}

/** The project a request names, its root or a file in it; the connection's hello project without one. */
interface At {
  project?: string
  /** s the query waits for its compile */
  timeout?: number
}
type Folders = { folders: string[] }
type Projects = { session: string; projects: { root: string; slug: string; url: string }[] }

/** Every `session/*` method: its params, its result and whether it writes, which a read-only connection is refused. */
export interface Methods {
  'session/status': { params: {}; result: SessionStatus; write: false }
  'session/stop': { params: {}; result: { stopping: string }; write: false }
  'session/attach': { params: Folders; result: Projects; write: false }
  'session/detach': { params: Folders; result: Projects; write: false }
  'session/clients': { params: {}; result: ClientInfo[]; write: false }
  'session/check': {
    params: At & { entries?: string[]; verbose?: boolean; json?: string; report?: boolean }
    result: Envelope<Ran & { report?: unknown; sets?: unknown[] }>
    write: false
  }
  'session/resolve': { params: At & { reference: string }; result: Envelope<unknown>; write: false }
  'session/q': {
    params: At & { reference: string; board?: string; target?: string }
    result: Envelope<{ exit: number; record?: Record<string, unknown>; error?: string; candidates?: unknown[] }>
    write: false
  }
  'session/inspect': {
    params: At & { entry?: string; target?: string; requests?: unknown[]; json?: boolean; verbose?: boolean }
    result: Envelope<Ran & { stderr: string }>
    write: false
  }
  'session/boards': { params: At & { entries?: string[]; select?: string[] }; result: Envelope<{ age: number; boards: SessionBoard[] }>; write: false }
  'session/layout': { params: { board: string; target: string | null; ref: string }; result: import('./site-data.js').SiteData; write: false }
  'session/facets': {
    params: { entry: string; target?: string | null; facets: FacetName[]; timeout?: number }
    result: { snapshot: string; entry: string; files: string[]; facets: FacetOut[] }
    write: false
  }
  'session/render': { params: At & { spec: unknown }; result: Envelope<{ png: string; legend: string; width: number; height: number; ms: number }>; write: false }
  'session/script': { params: At & { code: string; board?: string; target?: string; context?: string }; result: Envelope<ScriptResult>; write: true }
  'session/test': { params: At; result: Envelope<{ dir: string; failed: string[] }>; write: true }
  'session/events': {
    params: { project?: string; since?: string; kind?: string[] | string; scope?: string[] | string; follow?: boolean; wait?: boolean; for?: string[] | string; timeout?: number }
    /** with `follow` no events: they come as `session/event` after the answer */
    result: EventsPage & { following?: true }
    write: false
  }
  'session/edited': { params: { file: string; client?: string; name?: string; root?: string }; result: { file: string; by: By }; write: true }
  'session/claiming': { params: {}; result: {}; write: true }
  'session/describe': {
    params: { task?: string; plan?: string[] | string; progress?: string }
    result: { by: By; plan?: string[]; progress?: string; event?: string }
    write: false
  }
  'session/send': { params: SendParams; result: { id: string; to: By }; write: true }
  'session/ack': { params: { ids?: string[] }; result: { acknowledged: string[] }; write: false }
  'session/inbox': { params: { client?: string; name?: string; root?: string; ack?: boolean }; result: { messages: SessionEvent<'message'>[] }; write: false }
  'session/read': { params: { file: string }; result: { file: string; text: string; authority: 'editor' | 'restored' | 'disk'; version: number | null }; write: false }
  'session/write': { params: { file: string; edits?: { old: string; new: string }[]; text?: string }; result: Written & { created?: true }; write: true }
  'session/findings': {
    params: At & { board?: string; target?: string; scope?: string[] | string }
    result: { snapshot: string; stale: Stale | null; boards: unknown[] }
    write: false
  }
  /** by references, or a view's whole selection with the `base` seq it changed and the view it was made in, whose placements the editor shows */
  'session/select': {
    params: { project?: string; board: string; refs: string[]; anchor?: string; level?: string; finding?: string | null; focus?: boolean } | { project?: string; board: string; selection: Selection; base?: number; view?: ViewName }
    result: Selection | null
    write: false
  }
  'session/observe': { params: ObserveParams; result: null; write: false }
  'session/resync': { params: ResyncParams; result: { file: string; url: string }; write: false }
  /** sent without an id: nothing answers */
  'session/hover': { params: HoverMsg; result: null; write: false }
  'session/edit/begin': { params: EditBegin; result: { txn: string; tools: Tool[] }; write: true }
  'session/edit/update': { params: EditUpdate & { txn: string }; result: EditPlan; write: true }
  'session/edit/commit': { params: { txn: string }; result: EditResult; write: true }
  'session/edit/cancel': { params: { txn: string }; result: null; write: true }
  'session/edit/undo': { params: { txn?: string }; result: EditResult; write: true }
  'session/edit/redo': { params: { txn?: string }; result: EditResult; write: true }
}
export type Method = keyof Methods
export type Params<M extends Method> = Methods[M]['params']
export type Result<M extends Method> = Methods[M]['result']
/** A typed request, as every client of the session makes one. */
export type Request = <M extends Method>(method: M, params: Params<M>) => Promise<Result<M>>

/** One entry as `session/boards` answers it, for `pcbjs shot`. */
export interface SessionBoard {
  entry: string
  current: boolean
  reason?: string
  name?: string
  targets?: (string | null)[]
  select?: Record<string, string | null>
  ms?: number
}
/** `session/status`: the session's dev.json fields with its folders, projects, log, idle time and connections. */
export interface SessionStatus extends Omit<ReadyInfo, 'port' | 'host' | 'urls' | 'capabilities'> {
  session: string
  socket: string
  edit: 'localhost' | 'all' | 'none'
  checkout?: string
  token?: string
  tiers: Tiers
  url: string
  startedAt: string
  folders: string[]
  projects: { root: string; slug: string; url: string }[]
  log: string
  grace: number
  idle: number | null
  clients: (By & { kind: 'socket' | 'tcp'; mode: Mode; root?: string; task?: string; plan?: string[]; progress?: string })[]
  ready: ReadyInfo | null
}

const WRITES: { [M in Method]: Methods[M]['write'] } = {
  'session/status': false,
  'session/stop': false,
  'session/attach': false,
  'session/detach': false,
  'session/clients': false,
  'session/check': false,
  'session/resolve': false,
  'session/q': false,
  'session/inspect': false,
  'session/boards': false,
  'session/layout': false,
  'session/facets': false,
  'session/render': false,
  'session/script': true,
  'session/test': true,
  'session/events': false,
  'session/edited': true,
  'session/claiming': true,
  'session/describe': false,
  'session/send': true,
  'session/ack': false,
  'session/inbox': false,
  'session/read': false,
  'session/write': true,
  'session/findings': false,
  'session/select': false,
  'session/observe': false,
  'session/resync': false,
  'session/hover': false,
  'session/edit/begin': true,
  'session/edit/update': true,
  'session/edit/commit': true,
  'session/edit/cancel': true,
  'session/edit/undo': true,
  'session/edit/redo': true,
}
/** Every method, in the order Methods declares them. */
export const SESSION_METHODS = Object.keys(WRITES) as Method[]
/** The methods a read-only connection is refused. */
export const WRITE: ReadonlySet<Method> = new Set(SESSION_METHODS.filter(m => WRITES[m]))

// --- events

/** Every event the session sends, each frame numbered gapless per connection by `seq`: the `pcbjs:*` view events to the viewers of their project and board, the `pcbjs:ide:*` editor events by the capabilities of a hello. */
export interface Events {
  'pcbjs:status': LoadStatus
  'pcbjs:boards': BoardsMsg
  'pcbjs:scopes': ScopesMsg
  'pcbjs:error': { name: string | null; entry: string; message: string; stack: string; text: string | null }
  'pcbjs:focus': FocusEvent
  'pcbjs:sync:hover': HoverMsg
  'pcbjs:ide:finding': { project: string; board: string; target?: string | null; snapshot?: string; finding: (DrcMarker & { id: string; refs: string[] }) | null; refs: string[]; anchor: string | null }
  'pcbjs:select': SelectMsg
  'pcbjs:facet': FacetMsg
  'pcbjs:invalidate': Invalidate
  'pcbjs:editor': { attached: boolean }
  'pcbjs:grid': { board: string; grid: string | null }
  'pcbjs:assist': { board: string; assist: AssistContext | null }
  'pcbjs:assist:focus': { board: string; handle: string | null }
  'pcbjs:agents': { agents: AgentInfo[] }
  'pcbjs:ide:ready': Ready
  'pcbjs:ide:boards': IdeBoardsMsg
  'pcbjs:ide:scopes': ScopesMsg
  'pcbjs:ide:scope': ScopeMsg
  'pcbjs:ide:log': LogMsg
  'pcbjs:ide:bye': { reason: string }
  'session/state': StateMsg
  'session/event': SessionEvent
  'session/reset': { reset: string; next: string }
  'session/message': SessionEvent<'message'>
  'session/acked': { ids: string[] }
}
/** The one event a client sends the session, its first frame; everything after it is a `session/*` method or LSP. */
export interface Sends {
  'pcbjs:ide:hello': Hello
}

// --- posted messages of the viewer page in an editor pane or an iframe

export type { ViewName, DrawingView } from './site-facets.js'
/** What the page posts to the editor or the page around it. */
export type PagePost =
  | { type: 'pcbjs:devtools'; enabled: boolean }
  | { type: 'pcbjs:ready'; board: string; views: ViewName[] }
  | { type: 'pcbjs:hover'; uids: string[]; refs: string[]; net: string | null }
  | { type: 'pcbjs:select'; refs: string[]; anchor: string | null }
  | { type: 'pcbjs:view'; view: ViewName; side: 'F' | 'B'; mirror: boolean }
  | { type: 'pcbjs:facet'; board: string; target: string | null; facet: string; run: Run; stage: string }
  | ({ type: 'pcbjs:send' } & SendRequest)
  | { type: 'pcbjs:copy-markdown'; id: string; text: string }
  | { type: 'pcbjs:undo'; files: string[]; redo: boolean; board?: string; project?: string }
  | { type: 'pcbjs:edit-written'; board: string; files: string[]; project?: string }
  | { type: 'pcbjs:key'; key: string; code: string; keyCode: number; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; repeat: boolean }
/** What the editor or the page around it posts into the page; `board` switches first. */
export type HostPost =
  | { type: 'pcbjs:devtools'; enabled: boolean }
  | { type: 'pcbjs:copied-markdown'; id: string; ok: boolean }
  | { type: 'pcbjs:net'; board?: string | null; target?: string | null; net: string | null }
  | { type: 'pcbjs:finding'; board?: string | null; target?: string | null; id: string }
  | { type: 'pcbjs:view'; board?: string | null; target?: string | null; view?: ViewName; side?: 'F' | 'B'; mirror?: boolean }
  | { type: 'pcbjs:theme'; theme: 'light' | 'dark' }
  | { type: 'pcbjs:hover'; board?: string | null; target?: string | null; uids: string[]; refs: string[]; net?: string | null }
  | { type: 'pcbjs:select'; board?: string | null; target?: string | null; refs: string[] | null; frame?: boolean; by?: 'tree' | 'viewer' }

// --- the language server's additions

/** The pcbjs methods of the language server. */
export const METHODS = {
  focus: 'pcbjs/focus',
  select: 'pcbjs/select',
  preview: 'pcbjs/preview',
  segments: 'pcbjs/segments',
  tokens: 'pcbjs/tokens',
  flush: 'pcbjs/flush',
} as const

/** `initializationOptions.pcbjs`; without `protocol`, `major` and `capabilities` a client gets standard LSP only. */
export interface ClientHello {
  protocol: number
  major: number
  capabilities: string[]
  name?: string
  version?: string
}
/** `capabilities.experimental.pcbjs` of the answer. */
export interface ServerHello {
  /** the lower of the client's and the server's */
  protocol: number
  major: number
  /** the client capabilities this server honours for this client */
  capabilities: string[]
  methods: string[]
  version: string
}

/** `pcbjs/focus`: the active file, the primary cursor and every selection of the editor, the primary first. */
export interface FocusParams {
  textDocument: { uri: string }
  position: Position
  selections?: Range[]
}
/** `pcbjs/select`: one range per selected member, grouped by file; `primary` names the anchor's, `reveal` asks to show it and move the cursor there with focus kept where it is, `focus` to give the editor focus too, for an Open. */
export interface SelectParams {
  items: { uri: string; ranges: Range[] }[]
  primary: { uri: string; index: number }
  reveal: boolean
  focus?: boolean
}
/** `pcbjs/preview`: the page to show. */
export interface PreviewParams {
  /** without `ide` or `theme`, which the client adds */
  url: string
  scope?: string | null
}
export interface SegmentsParams {
  textDocument: { uri: string }
  range?: Range
  position?: Position
  /** a typed value for the segment at `position`, as `colorPresentation` takes a colour */
  value?: string
}

/** What a segment edits; a client renders its `widget`, never the kind. */
export const KINDS = ['number', 'length', 'angle', 'position', 'layer', 'enum', 'pathCommand', 'pinRef'] as const
export type SegmentKind = (typeof KINDS)[number]
export interface Constraints {
  unit?: string
  min?: number
  max?: number
  step?: number
  choices?: string[]
  grammar?: 'svg' | 'chain'
  index?: number
}
/** How a client edits a segment, so a new kind needs no client change. A client treats an unknown `input` as `text`. */
export interface Widget {
  input: 'number' | 'length' | 'angle' | 'position' | 'layer' | 'enum' | 'text' | 'none'
  /** whether a typed value is accepted; the server checks it through `pcbjs/segments` with `value` */
  typed: boolean
  prompt?: string
  options?: string[]
  unit?: string
  min?: number
  max?: number
  step?: number
  /** a CSS colour to show beside the value */
  preview?: string
}
export interface Presentation {
  label: string
  detail?: string
  edit: TextEdit
}
export interface Segment {
  range: Range
  kind: SegmentKind
  value: string
  label: string
  constraints: Constraints
  presentations: Presentation[]
  widget: Widget
  /** set when a typed `value` cannot be written; `presentations` is then empty */
  error?: string
}
/** `pcbjs/tokens`: a number, unit or layer inside a coordinate string, for a client that colours them itself. */
export interface UnitToken {
  range: Range
  type: 'number' | 'unit' | 'layer'
}
