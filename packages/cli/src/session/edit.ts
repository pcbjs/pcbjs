// The viewer's tools as transactions, `session/edit/begin`, `update`, `commit` and `cancel`: a drag previews many plans and writes one, through
// the session sources, where the entity was instantiated, or for an automatic leg of a chain with no source of its own into the entry's patches file; see docs/editing.md.
import { relative } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Board, Capability, EditNode, Pt, RouteRecord } from '@pcbjs/core/model'
import type { Patch, PatchOp } from '@pcbjs/core/internal/patch'
import { patchesFile } from '@pcbjs/core/internal/patch'
import { diffEdit, textDoc } from '@pcbjs/core/internal/textdoc'
import {
  TOOLS,
  type Against,
  type AssistContext,
  type AssistPreview,
  type By,
  type EditBegin,
  type EditPlan,
  type EditResult,
  type EditUpdate,
  type FileEdits,
  type Params,
  type TextEdit,
  type Tool,
  type ToolId,
  type Written,
  type Run,
} from '@pcbjs/core/protocol'
import { withPatch } from '../project/patch-text.js'
import { copperLayers } from '@pcbjs/core/internal/layers'
import { splitArc } from '@pcbjs/core/internal/trace-arc'
import { argOf, endOf, preview } from './assist.js'
import { againstOf, type Source } from './sources.js'
import { instanceIn, reachOf } from '@pcbjs/core/internal/instances'

type Lsp = typeof import('@pcbjs/lsp')
/** What a transaction reads: the compiled board, the text of a file as the session has it, and where writes go. */
export interface EditDeps {
  /** the project the transactions write, one per runtime */
  root: string
  board(name: string, isolate?: string | null): Board | null
  /** the entry file of a board, whose patches file sits beside it */
  entry(name: string): string | null
  /** the run of the current snapshot */
  run(): Run | null
  /** the text the session has of a file, see Sources */
  read(file: string): Source | null
  lsp(): Promise<Lsp>
  write(files: EditPlan['files'], by: By | null): Promise<Written[]>
  /** the editor's assist context on a board, null when the cursor waits for no argument */
  assist(board: string): AssistContext | null
}

interface Txn extends EditBegin {
  id: string
  by: By | null
  last: EditUpdate | null
  /** each rewritten literal as it read at the first plan, so a commit over a changed one is refused */
  guards: Map<string, string> | null
  /** an assist pick's context, as it was at begin */
  assist?: AssistContext
}

/** A placement's pose on the board, and how it is written. */
interface Pose {
  at: Pt
  rot: number
  side: 'F' | 'B'
}

const rad = (d: number) => (d * Math.PI) / 180
const GEOMETRIC = /^[LlHhVvAaX]$/
/** Turned counter-clockwise on screen by `deg` about `c`, y down. */
const turn = (p: Pt, c: Pt, deg: number): Pt => {
  const a = rad(deg),
    x = p[0] - c[0],
    y = p[1] - c[1]
  return [c[0] + x * Math.cos(a) + y * Math.sin(a), c[1] - x * Math.sin(a) + y * Math.cos(a)]
}
type Mat = EditNode['m']
const inv = (m: Mat): Mat => {
  const d = m[0] * m[3] - m[1] * m[2]
  const a = m[3] / d,
    b = -m[1] / d,
    c = -m[2] / d,
    e = m[0] / d
  return [a, b, c, e, -(a * m[4] + c * m[5]), -(b * m[4] + e * m[5])]
}
const apply = (m: Mat, p: Pt): Pt => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]]
const mirrored = (m: Mat) => m[0] * m[3] - m[1] * m[2] < 0

const nodeOf = (b: Board, ref: string) => b.edit?.find(e => e.ref === ref) ?? null
type Site = { file: string; line: number; col: number }
const same = (a: Site | undefined, b: Site | undefined) => !!a && !!b && a.file === b.file && a.line === b.line && a.col === b.col
const keyOf = (n: EditNode): 'at' | 'chain' => (n.src.chain ? 'chain' : 'at')
/** The nodes one literal places: one per instance of its definition that renders it, more in a loop or a helper called several times. */
const twins = (b: Board, n: EditNode) => (b.edit ?? []).filter(e => same(e.src[keyOf(n)], n.src[keyOf(n)]))
/** How many instances a write to a node's literal reaches: those of the definition that writes it whose drawing holds the literal, by their frames; one at the board level. */
function reach(b: Board, n: EditNode | null | undefined): number {
  if (!n?.def) return 1
  const insts = new Set(reachOf(b.schematic.circuits, n.def).map(c => c.path.join('/')))
  const held = twins(b, n).map(e => [...(e.frames ?? [])].reverse().find(f => insts.has(f.inst))?.inst)
  return Math.max(1, new Set(held.filter(Boolean)).size)
}
/** A literal code repeats within one instance, which no tool writes for all it places. */
const repeated = (b: Board, n: EditNode) => twins(b, n).length > reach(b, n)
const isWritable = (root: string, file: string) => file.startsWith(root + '/') && !file.includes('/node_modules/')

/** The tools the anchor's capabilities allow. */
export function toolsOf(node: EditNode | null): Tool[] {
  return node ? TOOLS.filter(t => node.caps.includes(t.needs)) : []
}

export function editTxns(d: EditDeps) {
  const txns = new Map<string, Txn>()
  const abs = (f: string) => (f.startsWith('/') ? f : `${d.root}/${f}`)

  const begin = (p: EditBegin, by: By | null) => {
    if (p?.tool === 'assist') return beginAssist(p, by)
    if (!p || typeof p.board !== 'string' || !Array.isArray(p.refs) || typeof p.anchor !== 'string' || !TOOLS.some(t => t.id === p.tool))
      throw new Error('session/edit/begin needs { board, tool, refs, anchor }')
    const b = d.board(p.board, p.isolate)
    if (!b) throw new Error(`no board ${p.board} in this session`)
    const now = d.run()
    if (p.run && now && p.run !== now) throw new Error(`the board changed since the view drew it, run ${p.run} is now ${now}; drag again`)
    const base = p.anchor
      .split('/')
      .filter(s => !/^(pt|leg):\d+$/.test(s))
      .join('/')
    const tools = toolsOf(nodeOf(b, base))
    if (!tools.some(t => t.id === p.tool)) throw new Error(`${p.anchor} takes no ${p.tool} tool`)
    const id = `edit${randomUUID()}`
    txns.set(id, { ...p, id, by, last: null, guards: null })
    return { txn: id, tools }
  }

  /** An assist pick: the context the editor gave when it began, refused when there is none. */
  const beginAssist = (p: EditBegin, by: By | null) => {
    if (typeof p.board !== 'string' || !d.board(p.board)) throw new Error(`no board ${String(p.board)} in this session`)
    const a = d.assist(p.board)
    if (!a) throw new Error('the editor cursor waits for no argument: put it in an empty chain call, a route end or at=""')
    const id = `edit${randomUUID()}`
    txns.set(id, { ...p, refs: [], anchor: a.ref ?? 'assist', id, by, last: null, guards: null, assist: a })
    return { txn: id, tools: [] as Tool[] }
  }

  const txnOf = (id: unknown): Txn => {
    const t = typeof id === 'string' ? txns.get(id) : undefined
    if (!t) throw new Error(`no edit ${String(id)} in this session; it was committed, cancelled or never begun`)
    return t
  }

  /** The plan of an update on the current text. */
  const plan = async (t: Txn, u: EditUpdate): Promise<{ txn: string } & ReturnType<Planner['result']>> => {
    if (u.grid !== undefined && (!Number.isFinite(u.grid) || u.grid <= 0)) throw new Error('grid must be a positive pitch in mm')
    const lsp = await d.lsp()
    const b = d.board(t.board, t.isolate)
    if (!b) throw new Error(`no board ${t.board} in this session`)
    const out = new Planner(lsp, b, d, abs, typeof t.isolate === 'string' ? t.isolate : null)
    if (t.assist) out.assist(t.assist, u)
    else if (t.tool === 'point') await out.point(t.anchor, u)
    else {
      const poses = t.refs.map(r => nodeOf(b, r)).filter((n): n is EditNode => !!n?.at)
      const c = centre(poses, nodeOf(b, t.anchor))
      for (const n of poses) out.place(n, posed(n, t.tool, u, c), u)
    }
    return { txn: t.id, ...out.result() }
  }

  const update = async (p: Params<'session/edit/update'>): Promise<EditPlan> => {
    const t = txnOf(p?.txn)
    const got = await plan(t, p)
    t.last = p
    t.guards ??= got.guards
    const { guards: _, cursor: __, ...rest } = got
    return { ...rest, findings: got.preview?.findings ?? [] }
  }

  const commit = async (p: { txn: string }): Promise<EditResult> => {
    const t = txnOf(p?.txn)
    txns.delete(t.id)
    if (!t.last) return { txn: t.id, written: [] as Written[] }
    const got = await plan(t, t.last)
    for (const [k, v] of t.guards ?? []) if (got.guards.get(k) !== v) return { txn: t.id, written: [], error: 'the source changed since the drag began; nothing was written' }
    if (!got.files.length) return { txn: t.id, written: [], error: got.notes.join('; ') || 'nothing to write' }
    const written = await d.write(got.files, t.by)
    const refused = written.find(w => !w.applied)
    return { txn: t.id, written, ...(refused ? { error: refused.reason ?? 'the editor refused the edit' } : {}), ...(got.cursor ? { cursor: got.cursor } : {}) }
  }

  const cancel = (p: { txn: string }): null => {
    txns.delete(txnOf(p?.txn).id)
    return null
  }
  return { begin, update, commit, cancel, open: () => txns.size }
}

/** The selection's centre for a turn of several, else the anchor's origin. */
function centre(nodes: EditNode[], anchor: EditNode | null): Pt {
  if (nodes.length < 2) return anchor?.pivot ?? (anchor?.at ? [anchor.at[0], anchor.at[1]] : nodes[0] ? [nodes[0].at![0], nodes[0].at![1]] : [0, 0])
  const xs = nodes.map(n => n.at![0]),
    ys = nodes.map(n => n.at![1])
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]
}

/** Where an update puts a placement. */
function posed(n: EditNode, tool: ToolId, u: EditUpdate, c: Pt): Pose {
  const at: Pt = [n.at![0], n.at![1]]
  const side = n.side ?? 'F'
  if (tool === 'move') return { at: [at[0] + (u.delta?.[0] ?? 0), at[1] + (u.delta?.[1] ?? 0)], rot: n.at![2], side }
  if (tool === 'rotate') return { at: turn(at, c, u.angle ?? 0), rot: n.at![2] + (u.angle ?? 0), side }
  return { at, rot: n.at![2], side: u.side ?? side }
}

const rel = (root: string, f: string) => relative(root, f) || f

/** The rotation a placement's `at` gave it in its own frame, degrees, for an `at` that was an expression. */
function localRot(n: EditNode): number {
  const mir = mirrored(n.m)
  const frame = (-Math.atan2(mir ? -n.m[1] : n.m[1], mir ? -n.m[0] : n.m[0]) * 180) / Math.PI
  const r = (n.at![2] - frame) * (mir ? -1 : 1)
  return Math.round((((r % 360) + 360) % 360) * 1e6) / 1e6
}

/** One plan being built: the edits per file, the patches, the notes and the guarded literals. */
class Planner {
  private edits = new Map<string, TextEdit[]>()
  /** the editor text each file's edits are computed on */
  private based = new Map<string, Against>()
  private patches: Patch[] = []
  readonly notes: string[] = []
  readonly guards = new Map<string, string>()
  /** an assist pick's trace and findings */
  shown: AssistPreview | null = null
  /** where the editor cursor goes after the pick, 1-based */
  after: { file: string; line: number; col: number } | null = null
  constructor(
    private lsp: Lsp,
    private b: Board,
    private d: EditDeps,
    private abs: (f: string) => string,
    /** the isolated instance: writes go to its definition, never to an own placement */
    private iso: string | null = null,
  ) {}

  /** The syntax tree of a file's text, shared with the language server. */
  private sf(file: string, text: string) {
    return this.lsp.docOf(file, text).sf()
  }
  /** The offset of a site in a file's text. */
  private at(file: string, text: string, s: { line: number; col: number }): number {
    return this.lsp.docOf(file, text).span(s).start
  }
  /** The note of a write, with how many instances follow a write to a definition. */
  private wrote(file: string, line: number, follow = 1): void {
    this.notes.push(`writes ${rel(this.d.root, file)}:${line}${follow > 1 ? `, ${follow} instances follow` : ''}`)
  }
  /** How many instances a node's literal reaches, inside an isolation where a shared one is written. */
  private follow(n: EditNode | null | undefined): number {
    return this.iso ? reach(this.b, n) : 1
  }

  private textOf(file: string): string | null {
    const s = this.d.read(file)
    const a = againstOf(s)
    if (a) this.based.set(file, a)
    return s?.text ?? null
  }
  private withBase(f: FileEdits): FileEdits {
    const a = this.based.get(f.file)
    return a ? { ...f, against: a } : f
  }
  private push(file: string, text: string, e: { start: number; end: number; newText: string }): void {
    const list = this.edits.get(file) ?? []
    list.push(this.lsp.docOf(file, text).edit(e))
    this.edits.set(file, list)
    this.guards.set(`${file}:${e.start}`, text.slice(e.start, e.end))
  }
  private patch(ref: string, op: PatchOp, hash: string | undefined, why: string): void {
    if (!hash) {
      this.notes.push(`${ref}: ${why}, and it has no hash to patch against`)
      return
    }
    this.patches.push({ ref, hash, op })
    this.notes.push(`writes a patch: ${why}`)
  }

  /** A placement's new pose, written where it was instantiated: its own element's `at` and `side`, a layout element's for an instance, a text's, or an own placement among the children of the layout element that placed a shared part. */
  place(n: EditNode, to: Pose, u: EditUpdate): void {
    if (n.auto?.length) {
      this.notes.push(`${n.ref}: its at is automatic; pcbjs place --write writes where the placer put it`)
      return
    }
    if (this.iso && n.owned) {
      this.notes.push(`${n.ref}: its own placement in ${n.owned} keeps it; the definition is not written`)
      return
    }
    const shared = reach(this.b, n),
      placed = twins(this.b, n).length
    if (placed > 1 && !this.iso && n.layout) return this.own(n, to, u, placed)
    if (placed > shared) {
      this.notes.push(`${n.ref}: its element places ${placed} parts, instances or groups in a loop or a helper; give it an element of its own in the source`)
      return
    }
    // inside an isolation the definition's element is written and every instance follows
    if (shared > 1 && !this.iso) {
      this.notes.push(
        `${n.ref}: its element places ${shared} instances or groups, one per instance of the definition around it; isolate that definition to write it for all, or give it an element of its own`,
      )
      return
    }
    const site = this.element(n.src.at)
    if (!site) {
      this.notes.push(`${n.ref}: its placement is in no file of this project`)
      return
    }
    const { file, text, el } = site
    if (u.grid !== undefined) {
      const change = this.lsp.setGrid(el, u.grid)
      if (!change) { this.notes.push(`${n.ref}: grid may come from a props spread; set an explicit grid attribute after the spread first`); return }
      this.push(file, text, change)
      this.wrote(file, n.src.at!.line, this.follow(n))
      return
    }
    const old = el.at?.value?.text
    // a literal in place of an expression its instances share would put them all in one spot
    if (el.at && old === undefined && shared > 1) {
      this.notes.push(`${n.ref}: its at is an expression ${shared} instances share; change it in the source`)
      return
    }
    const rot = (old === undefined ? localRot(n) : this.lsp.atRotation(old)) + (to.rot - n.at![2]) * (mirrored(n.m) ? -1 : 1)
    if (to.at[0] !== n.at![0] || to.at[1] !== n.at![1] || to.rot !== n.at![2]) this.push(file, text, this.lsp.setAt(el, this.atText(n, to, rot, old, u)))
    if (to.side !== (n.side ?? 'F')) {
      const e = this.lsp.setSide(text, el, (to.side === 'B') !== mirrored(n.m) ? 'B' : 'F')
      if (e) this.push(file, text, e)
      else if (el.side && !el.side.value) this.notes.push(`${n.ref}: side is computed; change it in the source`)
    }
    this.wrote(file, n.src.at!.line, this.follow(n))
  }

  /** The element that starts at a source, with its file's text; null outside the project. */
  private element(src: Site | undefined) {
    const file = src && this.abs(src.file)
    const text = file && isWritable(this.d.root, file) ? this.textOf(file) : null
    const el = text ? this.lsp.elementAt(this.sf(file!, text), this.at(file!, text, src!)) : null
    return el ? { file: file!, text: text!, el } : null
  }

  /** An `at` value for a pose in the placement's frame, in the style of the old value. */
  private atText(n: EditNode, to: Pose, rot: number, old: string | undefined, u: EditUpdate): string {
    const pitch = n.grid ? (this.b.grids?.find(g => g.name === n.grid)?.pitch ?? null) : null
    const local = apply(inv(n.m), to.at)
    return this.lsp.writeAt(local[0], local[1], rot, old, { pitch, free: !!u.free })
  }

  /** A part whose element places several: its own placement, `<CH1.R at="13 0" />`, among the children of the layout element that placed it, the shared element kept for the others. */
  private own(n: EditNode, to: Pose, u: EditUpdate, shared: number): void {
    const lay = n.layout
    const inst = instanceIn(n.frames, this.b.schematic.circuits)
    const from = this.element(n.src.at)
    // the layout element must place this instance alone, not one per instance of a definition around it
    const host = lay && inst && reach(this.b, nodeOf(this.b, inst)) === 1 ? this.element(lay.src) : null
    const g = host?.el.attrs.g?.expr
    const handle = g && `${g}.${lay!.member}`
    if (!from || !host || !handle || !/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)+$/.test(handle)) {
      this.notes.push(`${n.ref}: its element places ${shared} parts and no layout element of its own instance is in the source to give it its own placement; write one there`)
      return
    }
    const old = from.el.at?.value?.text
    const rot = (old === undefined ? localRot(n) : this.lsp.atRotation(old)) + (to.rot - n.at![2]) * (mirrored(n.m) ? -1 : 1)
    const side = (to.side === 'B') !== mirrored(n.m) ? ' side="B"' : ''
    const change = u.grid === undefined ? null : this.lsp.setGrid(from.el, u.grid)
    if (u.grid !== undefined && !change) { this.notes.push(`${n.ref}: grid may come from a props spread; set an explicit grid attribute after the spread first`); return }
    const grid = change ? ` ${change.newText.trim()}` : ''
    const rest = from.el.others.filter(a => u.grid === undefined || a !== from.el.attrs.grid?.text).map(a => ` ${a}`).join('')
    const child = `<${handle} at="${this.atText(n, to, rot, old, u)}"${side}${grid}${rest} />`
    this.push(host.file, host.text, this.lsp.addChild(host.text, host.el, this.at(host.file, host.text, lay!.src), child))
    this.notes.push(`writes ${rel(this.d.root, host.file)}:${lay!.src.line}, an own placement of ${n.ref} in ${inst}`)
  }

  /** A control point `route:3/pt:k` to a new place, or an automatic leg `route:3/leg:k` through a new waypoint. */
  async point(anchor: string, u: EditUpdate): Promise<void> {
    const m = /^(.*)\/(pt|leg):(\d+)$/.exec(anchor)
    if (!m || (!u.point && !u.remove && !u.command && !u.layer)) return
    const [, route, kind, k] = m
    const n = nodeOf(this.b, route)
    const rec = this.b.routes?.find(r => r.id === route)
    if (!n || !rec) throw new Error(`no route ${route} on this board`)
    if (kind === 'pt' && (u.command || u.layer)) return this.traceCall(n, rec, +k, u)
    if (kind === 'pt' && u.remove) return this.removeCall(n, rec, +k)
    if (!u.point) return
    const to = apply(inv(n.m), u.point.at)
    if (kind === 'pt' && u.insert) return this.insertCall(n, rec, +k, to)
    if (kind === 'leg') return this.waypoint(n, rec, +k, to, u.point.at)
    this.moveCall(n, rec, +k, to)
  }

  private chainText(n: EditNode): { file: string; text: string } | null {
    const src = n.src.chain
    if (!src || repeated(this.b, n) || (reach(this.b, n) > 1 && !this.iso)) return null
    const file = this.abs(src.file)
    const text = isWritable(this.d.root, file) ? this.textOf(file) : null
    return text ? { file, text } : null
  }

  private traceCall(n: EditNode, rec: RouteRecord, k: number, u: EditUpdate): void {
    const st = n.steps?.[k - 1], at = this.chainText(n)
    const call = at && this.callOf(at, st)
    if (!at || !call || !rec.pts?.[k] || !rec.pts[k - 1] || !/^[HhVvLlAaXZ]$/.test(call.method)) throw new Error('select a literal trace primitive to edit')
    const back = (p: Pt) => apply(inv(n.m), p)
    const command = u.command ?? call.method
    if (!/^[HhVvLlAaXZ]$/.test(command)) throw new Error('this trace primitive cannot be converted')
    if (command === 'Z' && k < (n.steps?.length ?? 0)) throw new Error('finish straight is available only for the final trace primitive')
    if (u.layer) {
      if (!copperLayers(this.b.copper).includes(u.layer)) throw new Error('choose a copper layer of this board')
      const edit = this.lsp.routeLayer(this.sf(at.file, at.text), call.name, u.layer)
      if (!edit) throw new Error('the route layer is computed; edit it in the source')
      this.push(at.file, at.text, edit)
    }
    if (u.command) {
      const args = command === 'Z' ? '' : /^[Aa]$/.test(command) ? `${argOf(command === 'a' ? 'l' : 'L', back(rec.pts[k - 1]), back(rec.pts[k]))}, ${/^[Aa]$/.test(call.method) ? call.args[2]?.text ?? '90' : '90'}` : argOf(command, back(rec.pts[k - 1]), back(rec.pts[k]))
      this.push(at.file, at.text, { start: call.name, end: call.end, newText: `${command}(${args})` })
    }
    this.wrote(at.file, st!.src!.line, this.follow(n))
  }

  private moveCall(n: EditNode, rec: RouteRecord, k: number, to: Pt): void {
    const steps = n.steps ?? []
    let j = k - 1
    while (j >= 0 && /^(via|cross|width|branch)$/.test(steps[j].op)) j--
    const st = steps[j]
    const at = this.chainText(n)
    if (j < 0 || !st?.src || !at || !rec.pts) {
      this.notes.push(`${n.ref}/pt:${k} has no chain call the tool can rewrite`)
      return
    }
    const local = (p: Pt) => apply(inv(n.m), p)
    const call = this.lsp.chainCallAt(this.sf(at.file, at.text), this.at(at.file, at.text, st.src))
    let following = j + 1
    while (following < steps.length && !/^[LlHhVvAaXZ]$/.test(steps[following].op)) following++
    const next = steps[following]?.src ? this.lsp.chainCallAt(this.sf(at.file, at.text), this.at(at.file, at.text, steps[following].src!)) : null
    const edits = call && this.lsp.movePoint(call, local(rec.pts[j]), endOf(call.method, local(rec.pts[j]), to), next && rec.pts[following + 1] ? { call: next, end: local(rec.pts[following + 1]) } : undefined)
    if (!edits) {
      this.notes.push(`${n.ref}/pt:${k}: its call takes no literal the tool can rewrite`)
      return
    }
    for (const e of edits) this.push(at.file, at.text, e)
    this.wrote(at.file, st.src.line, this.follow(n))
  }

  /** The chain call at a step's source, null when it has none. */
  private callOf(at: { file: string; text: string }, st: { src?: { line: number; col: number } } | undefined) {
    return st?.src ? this.lsp.chainCallAt(this.sf(at.file, at.text), this.at(at.file, at.text, st.src)) : null
  }

  /** Delete on `pt:k`: its call goes, and a relative call after it is rewritten to keep its end. */
  private removeCall(n: EditNode, rec: RouteRecord, k: number): void {
    const steps = n.steps ?? []
    const at = this.chainText(n)
    const call = at && /^[LlHhVvAaXZ]$/.test(steps[k - 1]?.op ?? '') ? this.callOf(at, steps[k - 1]) : null
    if (!at || !call || !rec.pts) {
      this.notes.push(`${n.ref}/pt:${k} has no chain call the tool can delete`)
      return
    }
    const local = (p: Pt) => apply(inv(n.m), p)
    let j = k
    while (j < steps.length && !/^[LlHhVvAaXZ]$/.test(steps[j].op)) j++
    const next = this.callOf(at, steps[j])
    const keep = next && rec.pts[j + 1] ? this.lsp.keepPoint(next, local(rec.pts[k - 1]), local(rec.pts[j + 1])) : []
    if (/^[lhvaHV]$/.test(next?.method ?? '') && !keep) throw new Error('the next primitive is computed; edit it in the source to preserve its endpoint')
    for (const e of [this.lsp.deleteCall(call), ...(/^[lhvaHV]$/.test(next?.method ?? '') ? (keep ?? []) : [])]) this.push(at.file, at.text, e)
    this.wrote(at.file, steps[k - 1].src!.line, this.follow(n))
  }

  /** A control point after `pt:k`, `.L('x y')` after its call or before the first, a relative call after it kept in place. */
  private insertCall(n: EditNode, rec: RouteRecord, k: number, to: Pt): void {
    const steps = n.steps ?? []
    const at = this.chainText(n)
    const before = at ? (k > 0 ? this.callOf(at, steps[k - 1]) : null) : null
    const first = at && k === 0 ? this.callOf(at, steps[0]) : null
    const route = n.src.chain
    const offset = before ? before.end : first ? first.dot : at && route ? this.lsp.chainEndOf(this.sf(at.file, at.text), this.at(at.file, at.text, route)) : null
    if (!at || offset === null || !rec.pts) {
      this.notes.push(`${n.ref}/pt:${k}: no chain call to put a point after`)
      return
    }
    const current = this.callOf(at, steps[k])
    if (current && /^[Aa]$/.test(current.method)) {
      if (current.args.length !== 3 || current.args.some(a => a.kind === 'other')) throw new Error('the arc arguments are computed; edit the source before splitting it')
      const from = apply(inv(n.m), rec.pts[k]), end = apply(inv(n.m), rec.pts[k + 1])
      const split = splitArc(from, end, steps[k].angle ?? 0, to)
      if (!split) throw new Error('choose an interior point of the arc')
      const relative = current.method === 'a', f = (value: number) => +value.toFixed(6)
      const first = relative ? [to[0] - from[0], to[1] - from[1]] : to
      const second = relative ? [end[0] - to[0], end[1] - to[1]] : end
      const angle = f(split.first), remainder = f((steps[k].angle ?? 0) - angle)
      if (!angle || !remainder) throw new Error('choose an interior point farther from the arc endpoint')
      this.push(at.file, at.text, { start: current.name, end: current.end, newText: `${current.method}(${f(first[0])}, ${f(first[1])}, ${angle}).${current.method}(${f(second[0])}, ${f(second[1])}, ${remainder})` })
      this.wrote(at.file, steps[k].src!.line, this.follow(n))
      return
    }
    let j = k
    while (j < steps.length && !/^[LlHhVvAaXZ]$/.test(steps[j].op)) j++
    const next = this.callOf(at, steps[j])
    const keep = next && rec.pts[j + 1] && /^[lhvaHV]$/.test(next.method) ? this.lsp.keepPoint(next, to, apply(inv(n.m), rec.pts[j + 1])) : []
    if (!keep) throw new Error('the next relative primitive is computed; edit it in the source to preserve its endpoint')
    for (const e of [this.lsp.insertPoint(offset, to), ...keep]) this.push(at.file, at.text, e)
    this.wrote(at.file, (steps[k - 1]?.src ?? route!).line, this.follow(n))
  }

  /** `.X(p)` before the call that ends the leg when the chain is a literal of the project, else a reroute patch through `board`. */
  private waypoint(n: EditNode, rec: RouteRecord, k: number, to: Pt, board: Pt): void {
    const at = this.chainText(n)
    const ends = (n.steps ?? []).filter(s => s.op === 'X')
    const end = ends[k - 1]
    if (at) {
      const call = end?.src ? this.lsp.chainCallAt(this.sf(at.file, at.text), this.at(at.file, at.text, end.src)) : null
      const route = n.src.chain!
      const tail = call ? call.dot : this.lsp.chainEndOf(this.sf(at.file, at.text), this.at(at.file, at.text, route))
      if (tail !== null && (call || k === ends.length || !ends.length)) {
        this.push(at.file, at.text, this.lsp.insertWaypoint(tail, to))
        this.wrote(at.file, (end?.src ?? route).line, this.follow(n))
        return
      }
    }
    const r3 = (v: number) => Math.round(v * 1000) / 1000
    this.patch(`${n.ref}/leg:${k}`, { reroute: { through: [`${r3(board[0])} ${r3(board[1])}`] } }, rec.hash, 'the chain is shared or not a literal of this project')
  }

  /** An assist pick at `u.point`: the argument written into the waiting call, its command changed by a shift pick, and the trace it previews. */
  assist(given: AssistContext, u: EditUpdate): void {
    if (given.ends) return this.end(given, u)
    const a = this.isolated(given)
    const text = this.textOf(a.file)
    if (!text || !isWritable(this.d.root, a.file) || text.slice(a.name0, a.name0 + a.command.length) !== a.command) {
      this.notes.push('the call the editor waited in changed; put the cursor back in it')
      return
    }
    if (u.layer && !copperLayers(this.b.copper).includes(u.layer)) throw new Error('choose a copper layer of this board')
    if (u.command && !/^[HhVvLlAaXZ]$/.test(u.command)) throw new Error('this trace primitive cannot be converted')
    if (u.command === 'Z' && a.ref) {
      const steps = nodeOf(this.b, a.ref)?.steps ?? []
      const index = steps.findIndex(st => st.src && this.abs(st.src.file) === a.file && this.at(a.file, text, st.src) === a.name0)
      if (index >= 0 && index < steps.length - 1) throw new Error('finish straight is available only for the final trace primitive')
    }
    if (!u.point) {
      if (u.command && a.command !== 'at') this.push(a.file, text, { start: a.name0, end: a.name0 + a.command.length, newText: u.command })
      if (u.layer && a.command !== 'at') {
        const edit = this.lsp.routeLayer(this.sf(a.file, text), a.name0, u.layer)
        if (!edit) throw new Error('the route layer is computed; edit it in the source')
        this.push(a.file, text, edit)
      }
      return
    }
    const n = a.ref ? nodeOf(this.b, a.ref) : null
    const back = (p: Pt) => (n ? apply(inv(n.m), p) : p)
    let command = u.command ?? a.command
    if (a.command !== 'at' && a.start) {
      if (u.pick) command = preview(this.b, a, u.point.at, 'l').findings.length ? 'X' : 'l'
      this.shown = preview(this.b, a, u.point.at, command)
    }
    let value: string
    if (a.command === 'at') {
      const local = back(u.point.at)
      const pitch = n?.grid ? (this.b.grids?.find(g => g.name === n.grid)?.pitch ?? null) : null
      value = this.lsp.writeAt(local[0], local[1], 0, undefined, { pitch, free: !!u.free })
    } else if (a.start) value = command === 'Z' ? '' : /^[Aa]$/.test(command) ? `${argOf(command === 'a' ? 'l' : 'L', back(a.start), back(u.point.at))}, ${a.typed[2] ?? 90}` : argOf(command, back(a.start), back(u.point.at))
    else {
      this.notes.push('the chain has no start yet; save or wait for the board')
      return
    }
    const close = a.command === 'at' ? '' : a.open ? ')' : ''
    // the whole call from its name, so every plan of a transaction guards the same text
    const e = a.command === 'at' ? { start: a.start0, end: a.end0, newText: value } : { start: a.name0, end: a.end0, newText: `${command}(${value}${close}` }
    this.push(a.file, text, e)
    const at = e.start + e.newText.length + (a.open || a.command === 'at' ? 0 : 1)
    const next = text.slice(0, e.start) + e.newText + text.slice(e.end)
    this.after = { file: a.file, ...textDoc(next).site(at) }
    this.wrote(a.file, textDoc(text).site(e.start).line, this.follow(n))
  }

  /** The assist context in the isolated instance's frame: the editor's call is the definition's, which the language server read through the first instance's route. */
  private isolated(a: AssistContext): AssistContext {
    const n = this.iso && a.ref ? nodeOf(this.b, a.ref) : null
    if (!n?.src.chain) return a
    const to = (this.b.edit ?? []).find(e => same(e.src.chain, n.src.chain) && !!e.frames?.some(f => f.inst === this.iso))
    if (!to || to === n) return a
    return { ...a, ref: to.ref, start: a.start ? apply(to.m, apply(inv(n.m), a.start)) : null }
  }

  /** A route end pick: the handle written into the slot, after a lone first end with `, ` so the cursor waits in the next one. */
  private end(a: AssistContext, u: EditUpdate): void {
    if (!u.end) return
    const text = this.textOf(a.file)
    if (!text || !isWritable(this.d.root, a.file) || !/^route\s*\(/.test(text.slice(a.name0))) {
      this.notes.push('the route call the editor waited in changed; put the cursor back in it')
      return
    }
    if (!a.ends!.candidates.some(c => c.handle === u.end)) {
      this.notes.push(`${u.end} is no end this slot offers`)
      return
    }
    const e = this.lsp.endEdit(text, a, u.end, true)
    this.push(a.file, text, e)
    this.after = { file: a.file, ...textDoc(text.slice(0, e.start) + e.newText + text.slice(e.end)).site(e.start + e.newText.length) }
    this.notes.push(`writes ${rel(this.d.root, a.file)}:${textDoc(text).site(e.start).line}`)
  }

  result(): { files: EditPlan['files']; notes: string[]; guards: Map<string, string>; preview: AssistPreview | null; cursor: Planner['after'] } {
    const files: EditPlan['files'] = [...this.edits].map(([file, edits]) => ({ file, edits }))
    if (this.patches.length) {
      const entry = this.d.entry(this.b.name)
      if (!entry) this.notes.push('no entry file to put the patches beside')
      else {
        const file = patchesFile(entry)
        const old = this.textOf(file)
        let text = old
        for (const p of this.patches) text = withPatch(text, p)
        const e = diffEdit(old ?? '', text!)
        files.push({
          file,
          edits: [textDoc(old ?? '').edit(e)],
          ...(old === null ? { create: true as const } : {}),
        })
      }
    }
    return { files: files.map(f => this.withBase(f)), notes: [...new Set(this.notes)], guards: this.guards, preview: this.shown, cursor: this.after }
  }
}
