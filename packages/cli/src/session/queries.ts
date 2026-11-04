// The session's queries over its snapshots: each settles its project first, then answers in an Envelope. docs/session.md has them.
import { under } from '../project/files.js'
import { readFileSync, realpathSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import type { Context } from 'node:vm'
import type { ProjectApi, ProjectsApi } from './plugin.js'
import type { Client, Clients, Handlers } from './clients.js'
import { checkLines, checkReport, slotsFailed, typecheckLines, writeReport } from '../project/report.js'
import { errorText } from '../project/compile.js'
import { typecheck } from '../project/typecheck.js'
import { boardKey, envelope, type Snapshot, type SnapshotSlot } from './snapshots.js'
import { boardDir } from '../project/project.js'
import type { Held } from '../project/compiler.js'
import { resolveRef } from './lineage.js'
import { EVENT_KINDS, type EventKind, type EventsPage, type SessionEvent } from '@pcbjs/core/protocol'
import type { EventLog, Filter } from './events.js'
import type { Feed } from './feed.js'
import { scopeOf } from './scope.js'
import { touched } from './touched.js'
import { answer, pickBoards, recordOf, snapshotBoards, type QAnswer, type QBoard } from '../project/query.js'
import { bind, runScript, scriptContext } from '../project/sandbox.js'
import { inspectMany, inspectOutput, pickTarget } from '../project/inspect.js'
import { refProblem, type InspectRequest } from '../project/dev-reuse.js'
import { writeTestDir } from '../project/test-dir.js'
import { parseSpec } from '../render/spec.js'
import { renderShot } from '../render/render.js'
import type { RenderWorker } from '../render/worker-client.js'
import { MAX_FRAME } from './frames.js'
import { siteFacets } from '../project/facets.js'

/** The references lineage follows: finding ids, nets and part refs. */
const LINEAGE = /^(drc|erc):|^net:|^[A-Za-z0-9_.+-]+$/

/** s a query waits for its compile, `--timeout` */
export const TIMEOUT_S = 120
/** s `events --wait` waits by default */
export const WAIT_S = 600

const real = (f: string) => {
  try {
    return realpathSync.native(f)
  } catch {
    return f
  }
}

async function projectFor(api: ProjectsApi | undefined, at: unknown, c: Client): Promise<ProjectApi> {
  const where = typeof at === 'string' && at ? at : c.hello?.project
  const p = await api?.find(where)
  if (!p) throw new Error(where ? `no project of this session holds ${where}` : 'this session serves no project')
  return p
}

async function settled(p: ProjectApi, timeout: unknown) {
  const s = Number(timeout ?? TIMEOUT_S)
  const { snap, stale } = await p.settle((Number.isFinite(s) && s > 0 ? s : TIMEOUT_S) * 1000)
  if (!snap) throw new Error(`no compile of ${p.root} finished within ${s} s`)
  return { snap, stale }
}

/** The slots of the named entries, every one without a list. */
function pick(snap: Snapshot, root: string, entries: unknown): SnapshotSlot[] {
  if (!Array.isArray(entries) || !entries.length) return snap.slots
  const want = new Set(entries.filter((e): e is string => typeof e === 'string').map(e => real(resolve(root, e))))
  const out = snap.slots.filter(s => want.has(real(s.entry.file)))
  if (out.length < want.size) throw new Error(`not an entry of ${root}: ${[...want].filter(w => !out.some(s => real(s.entry.file) === w)).join(', ')}`)
  return out
}

const boardsOf = (snap: Snapshot): QBoard[] => snapshotBoards(snap.slots, snap.id, snap.project, c => snap.findings.get(boardKey(c)) ?? [])

/** `pcbjs check` over the settled snapshot: its stdout and exit code; tsc reads the editors' unsaved text too. */
async function check(api: ProjectsApi | undefined, p: any, c: Client) {
  const t0 = performance.now()
  const prj = await projectFor(api, p?.project, c)
  const hold = prj.hold()
  const { snap, stale } = await settled(prj, p?.timeout)
  const slots = pick(snap, prj.root, p?.entries)
  const verbose = !!p?.verbose
  const json = typeof p?.json === 'string' && p.json ? p.json : undefined
  const store = api?.store()
  const open = (store?.files() ?? []).some(f => under(f, prj.root))
  const tc = typecheck(
    prj.root,
    slots.map(s => s.entry.file),
    open ? { overlay: f => store!.get(f)?.text } : {},
  )
  const errorOf = (s: unknown) => (s as SnapshotSlot).error
  const lines = [...holdLines(hold), ...checkLines(prj.root, slots, errorOf, { verbose, json }), ...typecheckLines(tc, verbose)]
  let exitCode = slotsFailed(slots) || tc?.errors.length ? 1 : 0
  const report = json || p?.report ? checkReport(prj.cfg, 'check', slots, errorOf, tc, performance.now() - t0) : undefined
  if (report && json) lines.push(`json   ${writeReport(prj.root, json, report)}`)
  if (report) exitCode = report.exit
  const out = { stdout: lines.join('\n') + '\n', exitCode }
  return envelope(snap, stale, p?.report ? { ...out, report, sets: fabSets(prj.cfg.fabDir, slots) } : out)
}

/** A draft that held its compile: the check compiled it as the repair makes it. */
const holdLines = (h: { file: string; line: number } | null) => (h ? [`held       ${h.file}:${h.line} has an error; checked the draft as the repair makes it`] : [])

/** Where each board's fab set goes and what it is built from, in the report's board order. */
function fabSets(fabDir: string, slots: SnapshotSlot[]) {
  return slots.flatMap(s =>
    s.conflict
      ? []
      : (s.compiled ?? []).map(c => {
          const dir = join(fabDir, ...boardDir(c.board))
          // a compile of some views only has no fab set, the site data still names its zip
          const zip = c.site?.fab?.name
          return { name: c.board.name, target: c.board.variant?.name ?? null, rev: c.board.rev || null, entry: s.entry.file, dir, zip: zip ? join(dir, zip) : null, files: c.files }
        }),
  )
}

/** A reference held from any snapshot, as the current one names it: exact, by lineage, or gone with the nearest. */
async function resolveIt(api: ProjectsApi | undefined, p: any, c: Client) {
  if (typeof p?.reference !== 'string' || !p.reference) throw new Error('session/resolve needs { reference }')
  const prj = await projectFor(api, p.project, c)
  const { snap, stale } = await settled(prj, p.timeout)
  const r = resolveRef(snap, prj.previous(), p.reference)
  return envelope(snap, r.stale ?? stale, r)
}

/** `pcbjs q`: one reference's record; one an older snapshot minted answers as the current one names it. */
async function query(api: ProjectsApi | undefined, p: any, c: Client) {
  if (typeof p?.reference !== 'string' || !p.reference) throw new Error('session/q needs { reference }')
  const prj = await projectFor(api, p.project, c)
  const { snap, stale } = await settled(prj, p.timeout)
  const all = boardsOf(snap)
  const o = { board: str(p.board), target: str(p.target) }
  const done = (a: QAnswer, st: typeof stale) => envelope(snap, st, a.exit === 0 ? { exit: 0, record: recordOf(a) } : a)
  const a = answer(all, p.reference, o)
  const bare = p.reference.replace(/^board:[^/]+\//, '')
  if (a.exit !== 1 || a.candidates || !LINEAGE.test(bare)) return done(a, stale)
  // not in the current snapshot: as the previous one's source call became
  const r = resolveRef(snap, prj.previous(), bare)
  if (!r.ref) return envelope(snap, r.stale ?? stale, { ...a, ...(r.candidates?.length ? { candidates: r.candidates } : {}) })
  return done(answer(all, r.ref, o), r.stale)
}

/** `pcbjs inspect` over the settled snapshot: what it prints, or the error line of a failed entry. */
async function inspect(api: ProjectsApi | undefined, p: any, c: Client) {
  const prj = await projectFor(api, p?.project, c)
  const { snap, stale } = await settled(prj, p?.timeout)
  const file = typeof p?.entry === 'string' ? real(resolve(prj.root, p.entry)) : null
  const slot = file ? snap.slots.find(s => real(s.entry.file) === file) : snap.slots.length === 1 ? snap.slots[0] : null
  if (!slot) throw new Error(file ? `not an entry of ${prj.root}: ${file}` : `inspect looks at one board, name its entry: ${snap.slots.map(s => s.entry.rel).join(', ')}`)
  const out = (stdout: string, stderr: string, exitCode: number) => envelope(snap, stale, { stdout, stderr, exitCode })
  if (!slot.compiled || slot.conflict) {
    const t = errorText(slot.error, !!p?.verbose, prj.root)
    return out('', [`${slot.entry.rel}  compile error: ${slot.conflict ?? t.line}`, ...t.detail.map(l => `  ${l}`)].join('\n') + '\n', 1)
  }
  const t = pickTarget(slot.compiled, str(p?.target))
  if (typeof t === 'string') return out('', `pcbjs: ${t}\n`, 1)
  const requests: InspectRequest[] = Array.isArray(p?.requests) ? p.requests : [{}]
  const results = inspectMany(t.board, relative(prj.root, t.entry.file) || t.entry.rel, prj.root, requests)
  return out(inspectOutput(results, requests, !!p?.json).join('\n') + '\n', '', results.every(r => r.found) ? 0 : 1)
}

/** `pcbjs shot`: each entry's boards and targets, and what each `--select` names on them. */
async function boards(api: ProjectsApi | undefined, p: any, c: Client) {
  const prj = await projectFor(api, p?.project, c)
  const { snap, stale } = await settled(prj, p?.timeout)
  const files: string[] = Array.isArray(p?.entries) ? p.entries.map((e: string) => real(resolve(prj.root, e))) : snap.slots.map(s => s.entry.file)
  const list = files.map(f => {
    const s = snap.slots.find(x => real(x.entry.file) === real(f))
    if (!s?.compiled || s.conflict) return { entry: f, current: false, reason: s ? (s.conflict ?? 'its last compile failed') : 'no such entry' }
    const c0 = s.compiled[0]
    return {
      entry: f,
      current: !stale,
      name: c0.board.name,
      targets: s.compiled.map(c => c.board.variant?.name ?? null),
      select: Object.fromEntries((Array.isArray(p?.select) ? p.select.map(String) : []).map((r: string) => [r, refProblem(c0.board, r)])),
      ms: Math.round(c0.ms),
    }
  })
  return envelope(snap, stale, { age: Date.now() - snap.at, boards: list })
}

/** `session/facets`: an entry's facets in the settled snapshot, for the `?pcb:` imports of a site beside the session; an unknown entry is an error, which the plugin answers by compiling itself. */
async function facets(api: ProjectsApi | undefined, p: any, c: Client) {
  if (typeof p?.entry !== 'string' || !Array.isArray(p?.facets)) throw new Error('session/facets needs { entry, facets }')
  const prj = await projectFor(api, p.entry, c)
  const { snap } = await settled(prj, p.timeout)
  const file = real(resolve(prj.root, p.entry))
  const slot = snap.slots.find(s => real(s.entry.file) === file)
  if (!slot) throw new Error(`not an entry of ${prj.root}: ${p.entry}`)
  const target = typeof p.target === 'string' ? p.target : null
  const out = slot.compiled?.find(k => (target === null ? true : k.board.variant?.name === target))
  if (!out?.site) throw new Error(slot.compiled ? `no target ${target} of ${p.entry}` : errorText(slot.error, false, prj.root).line)
  const want = new Set(p.facets.map(String))
  return { snapshot: snap.id, entry: file, files: out.files, facets: siteFacets(out.site).filter(f => want.has(f.facet)) }
}

/** `session/render`: one shot of the render spec by the session's renderer worker, the PNG as base64 beside its legend. */
async function render(h: QueryHooks, p: any, c: Client) {
  const spec = parseSpec(p?.spec)
  const prj = await projectFor(h.api(), p?.project, c)
  const { snap, stale } = await settled(prj, p?.timeout)
  const [slot] = pick(snap, prj.root, spec.entry ? [spec.entry] : undefined)
  if (!spec.entry && snap.slots.length > 1) throw new Error(`render looks at one board, name its entry: ${snap.slots.map(s => s.entry.rel).join(', ')}`)
  if (!slot.compiled || slot.conflict) throw new Error(`${slot.entry.rel}: ${slot.conflict ?? 'its last compile failed'}`)
  const t = pickTarget(slot.compiled, spec.target)
  if (typeof t === 'string') throw new Error(t)
  const findings = snap.findings.get(boardKey(t)) ?? []
  const shot = await renderShot({ compiled: t, glb: () => prj.artifact(t, 'glb'), findings, project: prj.root, snapshot: snap.id, spec, worker: h.renderer })
  const png = Buffer.from(shot.png).toString('base64')
  if (png.length > MAX_FRAME - 65536) throw new Error(`the ${shot.width}x${shot.height} PNG is too large for the session socket; ask for a smaller size`)
  return envelope(snap, stale, { png, legend: shot.legend, width: shot.width, height: shot.height, ms: Math.round(shot.ms) })
}

const contexts = new WeakMap<Client, Map<string, { ctx: Context; snapshot: string }>>()

/** `pcbjs script` and `repl`: the code against the settled snapshot; a repl keeps its context per connection, rebinding `board` to the newest snapshot. */
async function script(api: ProjectsApi | undefined, p: any, c: Client) {
  if (typeof p?.code !== 'string') throw new Error('session/script needs { code }')
  const prj = await projectFor(api, p.project, c)
  const { snap, stale } = await settled(prj, undefined)
  const picked = pickBoards(boardsOf(snap), { target: str(p.target) })
  const board = p.board ? (picked.find(b => b.name === p.board) ?? null) : (picked[0] ?? null)
  if (p.board && !board) throw new Error(`no board ${p.board}; boards: ${picked.map(b => b.name).join(', ')}`)
  const g = { board: board?.api ?? null, boards: picked.map(b => b.api), snapshot: snap.id }
  const name = typeof p.context === 'string' ? p.context : null
  let held = name ? contexts.get(c)?.get(name) : undefined
  const moved = !!held && held.snapshot !== snap.id
  if (held) bind(held.ctx, g)
  else {
    held = { ctx: scriptContext(g), snapshot: snap.id }
    if (name) (contexts.get(c) ?? contexts.set(c, new Map()).get(c)!).set(name, held)
  }
  held.snapshot = snap.id
  return envelope(snap, stale, { ...runScript(p.code, held.ctx, p.timeout), moved })
}

/** `pcbjs test`: the snapshot's boards written for `board()` of @pcbjs/cli/test. */
async function test(api: ProjectsApi | undefined, p: any, c: Client) {
  const prj = await projectFor(api, p?.project, c)
  const { snap, stale } = await settled(prj, p?.timeout)
  const dir = await writeTestDir(prj.root, snap.id, boardsOf(snap), c => prj.artifact(c as Held, 'fab'))
  const failed = snap.slots.filter(s => !s.compiled || s.conflict).map(s => s.entry.rel)
  return envelope(snap, stale, { dir, failed })
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)

const kindsOf = (v: unknown): Set<EventKind> | null => {
  const list = (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []).map(String).filter(Boolean)
  if (!list.length) return null
  const bad = list.filter(k => !EVENT_KINDS.includes(k as EventKind))
  if (bad.length) throw new Error(`no event kind ${bad.join(', ')}; the kinds are ${EVENT_KINDS.join(', ')}`)
  return new Set(list as EventKind[])
}

export interface QueryHooks {
  api(): ProjectsApi | undefined
  events(): EventLog | undefined
  feed(): Feed | undefined
  /** the current and previous snapshot of a project, for what a scoped event touches */
  snapshots(project: string): { cur: Snapshot | null; prev: Snapshot | null }
  /** a subscriber began or ended: the demand changed */
  wake(): void
  /** the session's renderer worker, started on the first shot */
  renderer(): RenderWorker
  clients(): Clients | undefined
}

const disk = (f: string) => {
  try {
    return readFileSync(f, 'utf8')
  } catch {
    return null
  }
}

/** `session/events`: the events after `since`; with `wait` up to the first of the kinds `for`; with `follow` every one after as `session/event`. */
async function events(h: QueryHooks, p: any, c: Client) {
  const log = h.events()
  if (!log) throw new Error('this server keeps no events log')
  const patterns: string[] = Array.isArray(p?.scope) ? p.scope.map(String) : typeof p?.scope === 'string' ? [p.scope] : []
  const scope = patterns.length ? scopeOf(patterns) : null
  const project = str(p?.project) ? (await h.api()?.find(p.project))?.root : undefined
  const f: Filter = {
    kinds: kindsOf(p?.kind),
    ...(project ? { project } : {}),
    ...(scope
      ? {
          scope: (e: SessionEvent) => {
            const s = h.snapshots(e.project)
            return scope.test(touched(e, s.cur, s.prev, disk))
          },
        }
      : {}),
  }
  const since = str(p?.since) ?? null
  if (p?.follow) {
    const first = since ? log.since(since, f) : { events: [], next: log.next() }
    const off = log.subscribe(f, e => c.event('session/event', e))
    c.onClose(() => {
      off()
      h.wake()
    })
    h.wake()
    // after the answer, in order: a reset first when the cursor was stale
    setImmediate(() => {
      if (first.reset) c.event('session/reset', { reset: first.reset, next: first.next })
      for (const e of first.events) c.event('session/event', e)
    })
    return { events: [], following: true as const, next: first.next, ...(first.reset ? { reset: first.reset } : {}) }
  }
  if (!p?.wait) return log.since(since, f)
  const want = kindsOf(p?.for)
  const hit = (e: SessionEvent) => !want || want.has(e.kind)
  const seen = since ? log.since(since, f) : { events: [], next: log.next() }
  const at = seen.events.findIndex(hit)
  if (at >= 0) return { events: seen.events.slice(0, at + 1), next: seen.events[at].id, ...(seen.reset ? { reset: seen.reset } : {}) }
  const s = Number(p?.timeout ?? WAIT_S)
  const ms = (Number.isFinite(s) && s >= 0 ? s : WAIT_S) * 1000
  const got: SessionEvent[] = [...seen.events]
  // the kinds waited for are delivered too, and only they make the wait an observer
  const sub: Filter = { ...f, kinds: f.kinds && want ? new Set([...f.kinds, ...want]) : f.kinds, ...(want ? { demand: [...want] } : {}) }
  return new Promise<EventsPage>(done => {
    let over = false
    const end = (timeout: boolean) => {
      if (over) return
      over = true
      clearTimeout(t)
      off()
      h.wake()
      const next = got.length ? got[got.length - 1].id : seen.next
      done({ events: got, next, ...(timeout ? { timeout: true } : {}), ...(seen.reset ? { reset: seen.reset } : {}) })
    }
    const t = setTimeout(() => end(true), ms)
    const off = log.subscribe(sub, e => {
      got.push(e)
      if (hit(e)) end(false)
    })
    c.onClose(() => end(true))
    h.wake()
  })
}

export type QueryMethod =
  | 'session/check'
  | 'session/resolve'
  | 'session/q'
  | 'session/inspect'
  | 'session/boards'
  | 'session/facets'
  | 'session/render'
  | 'session/script'
  | 'session/test'
  | 'session/events'

export function queryMethods(h: QueryHooks): Pick<Handlers, QueryMethod> {
  return {
    'session/check': (p, c) => check(h.api(), p, c),
    'session/resolve': (p, c) => resolveIt(h.api(), p, c),
    'session/q': (p, c) => query(h.api(), p, c),
    'session/inspect': (p, c) => inspect(h.api(), p, c),
    'session/boards': (p, c) => boards(h.api(), p, c),
    'session/facets': (p, c) => facets(h.api(), p, c),
    'session/render': (p, c) => render(h, p, c),
    'session/script': (p, c) => script(h.api(), p, c),
    'session/test': (p, c) => test(h.api(), p, c),
    'session/events': (p, c) => events(h, p, c),
  }
}
