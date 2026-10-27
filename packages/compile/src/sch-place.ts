// Automatic schematic placement: small parts clustered onto the symbol they connect to, the clusters and group sheets packed
// in reading order into a free page of about A-paper proportions, or the paper asked for, with wire channels between blocks that share nets. Grid units, y down.
import type { Mat, Pt } from '@pcbjs/core/model'
import type { PinSide } from '@pcbjs/core/sch-model'
import { textUnits, type SymbolDef } from '@pcbjs/core/sch-symbol'

export type Box = [number, number, number, number]
/** The page: null free, a PAPERS index to start from, or a fixed paper in mm. */
export type Sheet = null | number | [number, number]
/** name, width and height in mm, landscape */
export const PAPERS: [string, number, number][] = [['A4', 297, 210], ['A3', 420, 297], ['A2', 594, 420], ['A1', 841, 594], ['A0', 1189, 841]]
/** Paper border and the least gap between blocks, grid units. */
export const MARGIN = 4
export const GAP = 3
/** Paper height kept for the title block, mm. */
export const TITLE = 30
/** Grid units of channel per net crossing between two blocks, and the most a channel grows. */
const CHANNEL = 1
const CHANNEL_MAX = 8
/** Group sheet padding around its blocks: sides, top for the name. */
const PAD = 2
const PAD_TOP = 3

export const r6 = (v: number) => Math.round(v * 1e6) / 1e6 || 0
export const SIDE_V: Record<PinSide, Pt> = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] }
export const boxOf = (pts: Pt[]): Box => [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))]

/** Rotate counterclockwise on the y-down sheet, after an optional mirror in x. */
export function symMatrix(at: Pt, rot: number, flip: boolean, scale = 1): Mat {
  const t = (rot * Math.PI) / 180, c = Math.round(Math.cos(t)), s = Math.round(Math.sin(t)), f = flip ? -1 : 1
  return [c * f * scale, -s * f * scale, s * scale, c * scale, at[0] * scale, at[1] * scale]
}
export const apply = (m: Mat, p: Pt): Pt => [r6(m[0] * p[0] + m[2] * p[1] + m[4]), r6(m[1] * p[0] + m[3] * p[1] + m[5])]
export function sideOf(m: Mat, side: PinSide): PinSide {
  const v = SIDE_V[side], x = m[0] * v[0] + m[2] * v[1], y = m[1] * v[0] + m[3] * v[1]
  return Math.abs(x) > Math.abs(y) ? (x > 0 ? 'right' : 'left') : y > 0 ? 'bottom' : 'top'
}
/** The body and pin ends of a symbol, one unit around. */
export function extentOf(sym: SymbolDef, m: Mat): Box {
  const b = boxOf([apply(m, [sym.box[0], sym.box[1]]), apply(m, [sym.box[2], sym.box[3]]), ...sym.pins.map(x => apply(m, x.end))])
  return [b[0] - 1, b[1] - 1, b[2] + 1, b[3] + 1]
}
export type TextMode = 'over' | 'beside' | 'corners'
export function textMode(sym: SymbolDef, pins: { side: PinSide }[]): TextMode {
  if (sym.kind === 'box' || sym.kind === 'connector' || sym.kind === 'custom') return 'corners'
  return pins.every(q => q.side === 'left' || q.side === 'right') ? 'over' : 'beside'
}

export interface PlaceItem {
  ref: string
  value: string
  prefix: string
  sym: SymbolDef
  pins: { name: string; net: string | null }[]
  path: string[]
  /** declaration order */
  order: number
}
export interface Placement { at: Pt; rot: number; flip: boolean }
/** How blocks are ordered before packing: by pin count, by nets shared with what is placed, or as declared. */
export type PlaceOrder = 'pins' | 'link' | 'source'
export interface PlaceInput {
  items: PlaceItem[]
  power: (net: string) => boolean
  ground: (net: string) => boolean
  /** a net likely drawn with wires, so it needs a channel */
  wired: (net: string) => boolean
  /** hand-placed content, kept clear */
  fixed: Box[]
  sheet: Sheet
  grid: number
  order: PlaceOrder
}
export interface PlaceResult { at: Map<string, Placement>; paper: string | null }

/** `wired`: the pin joined to the chain before it, which needs no room for a label */
interface Member { it: PlaceItem; at: Pt; rot: number; flip: boolean; wired?: string }
interface Block { members: Member[]; ext: Box; nets: Set<string>; pins: number; order: number; top: string; conn: boolean; mirror?: () => Block }
interface Unit { blocks: Block[]; offs: Pt[]; w: number; h: number; nets: Set<string>; pins: number; order: number }
interface Link { anchor: PlaceItem; pin: string; decap: boolean }

const ORIENTS: [number, boolean][] = [[0, false], [0, true], [90, false], [270, false], [180, false], [90, true], [270, true], [180, true]]
const OPPOSITE: Record<PinSide, PinSide> = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' }
const isConn = (it: PlaceItem) => it.sym.kind === 'connector' || /^(J|P|CN|USB)$/i.test(it.prefix)
const shared = (a: Set<string>, b: Set<string>) => { let n = 0; for (const x of a) if (b.has(x)) n++; return n }
const common = (a: string[], b: string[]) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i }

/** A symbol's extent at an orientation with its ref, value and room for a label at each connected pin but `wired`. */
export function symExtent(it: Pick<PlaceItem, 'ref' | 'value' | 'sym' | 'pins'>, rot: number, flip: boolean, power: (net: string) => boolean, wired?: string): Box {
  const m = symMatrix([0, 0], rot, flip), sym = it.sym
  const e = extentOf(sym, m)
  const b = boxOf([apply(m, [sym.box[0], sym.box[1]]), apply(m, [sym.box[2], sym.box[3]])])
  const pins = sym.pins.map(p => ({ name: p.name, end: apply(m, p.end), side: sideOf(m, p.side) }))
  const len = Math.max(textUnits(it.ref), textUnits(it.value))
  if (textMode(sym, pins) === 'beside') e[2] = Math.max(e[2], b[2] + 1 + len)
  else { e[1] -= 1; e[3] += 1; e[2] = Math.max(e[2], e[0] + 1 + len) }
  for (const p of pins) {
    const net = it.pins.find(q => q.name === p.name)?.net
    if (!net || p.name === wired) continue
    const l = (power(net) ? 2 : Math.ceil(textUnits(net) + 1.2)) + 1
    if (p.side === 'left') e[0] = Math.min(e[0], p.end[0] - l)
    if (p.side === 'right') e[2] = Math.max(e[2], p.end[0] + l)
    if (p.side === 'top') e[1] = Math.min(e[1], p.end[1] - l)
    if (p.side === 'bottom') e[3] = Math.max(e[3], p.end[1] + l)
  }
  return e
}

/** Pin end and side on the sheet at an orientation, the symbol at the origin. */
function pinAt(it: PlaceItem, name: string, rot: number, flip: boolean): { end: Pt; side: PinSide } | null {
  const p = it.sym.pins.find(q => q.name === name)
  if (!p) return null
  const m = symMatrix([0, 0], rot, flip)
  return { end: apply(m, p.end), side: sideOf(m, p.side) }
}
/** The first orientation that turns `pin` to `side`; two-pin parts may turn, others only mirror. */
function orientFor(it: PlaceItem, pin: string | null, side: PinSide): [number, boolean] {
  const turns = it.sym.pins.length <= 2 ? ORIENTS : ORIENTS.slice(0, 2)
  if (!pin) return [0, false]
  return turns.find(([r, f]) => pinAt(it, pin, r, f)?.side === side) ?? [0, false]
}

/** Every small part's link to the symbol it serves: a signal net it shares, else the supply it decouples. */
function linkSmalls(items: PlaceItem[], anchors: PlaceItem[], power: (n: string) => boolean, ground: (n: string) => boolean): Map<PlaceItem, Link> {
  const out = new Map<PlaceItem, Link>()
  const rank = (s: PlaceItem, a: PlaceItem) => [-common(s.path, a.path), Math.abs(s.order - a.order), a.order]
  const load = new Map<PlaceItem, number>()
  const size = new Map<string, number>()
  for (const it of items) for (const q of it.pins) if (q.net) size.set(q.net, (size.get(q.net) ?? 0) + 1)
  const better = (x: number[], y: number[]) => { for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i]; return false }
  for (const s of items) {
    if (anchors.includes(s)) continue
    const mates = anchors.filter(a => (a.path[0] ?? '') === (s.path[0] ?? ''))
    const sig = new Set(s.pins.filter(q => q.net && !power(q.net)).map(q => q.net!))
    let best: { a: PlaceItem; pin: string; key: number[] } | null = null
    if (sig.size) {
      for (const a of mates) {
        const netOf = (p: { name: string }) => a.pins.find(q => q.name === p.name)?.net ?? ''
        const hits = a.sym.pins.filter(p => sig.has(netOf(p))).sort((u, v) => size.get(netOf(u))! - size.get(netOf(v))!)
        if (!hits.length) continue
        // a tie goes to the symbol on the more private net, the connector side of a coupling capacitor
        const key = [-hits.length, size.get(netOf(hits[0]))!, ...rank(s, a)]
        if (!best || better(key, best.key)) best = { a, pin: hits[0].name, key }
      }
      if (best) out.set(s, { anchor: best.a, pin: best.pin, decap: false })
      continue
    }
    const supply = s.pins.find(q => q.net && !ground(q.net))?.net
    if (!supply || isConn(s) || s.sym.pins.length !== 2) continue
    // decoupling spreads over the symbols on its supply by how many supply pins each has
    for (const a of mates.filter(a => !isConn(a))) {
      const hits = a.sym.pins.filter(p => a.pins.find(q => q.name === p.name)?.net === supply)
      const hit = hits[0]
      if (!hit) continue
      const key = [-common(s.path, a.path), ((load.get(a) ?? 0) + 1) / hits.length, ...rank(s, a).slice(1)]
      if (!best || better(key, best.key)) best = { a, pin: hit.name, key }
    }
    if (best) { out.set(s, { anchor: best.a, pin: best.pin, decap: true }); load.set(best.a, (load.get(best.a) ?? 0) + 1) }
  }
  return out
}

interface ChainPart { it: PlaceItem; entry: string | null; pred: PlaceItem | null; net: string | null }
/** Small parts reached from `head` through signal nets of at most three pins, in breadth-first order. */
function chainFrom(head: ChainPart, free: Set<PlaceItem>, byNet: Map<string, PlaceItem[]>, power: (n: string) => boolean): ChainPart[] {
  const out = [head]
  for (let i = 0; i < out.length; i++) {
    const c = out[i]
    for (const q of c.it.pins) {
      if (!q.net || power(q.net) || q.name === c.entry) continue
      const on = byNet.get(q.net) ?? []
      if (on.length > 3) continue
      for (const n of on) if (free.has(n) && (n.path[0] ?? '') === (c.it.path[0] ?? '')) {
        free.delete(n)
        out.push({ it: n, entry: n.pins.find(z => z.net === q.net)!.name, pred: c.it, net: q.net })
      }
    }
  }
  return out
}

/** Lays a chain outward along `dir` from `start`, the head's entry pin on `lane`; members are placed in the chain's frame. */
function layChain(chain: ChainPart[], dir: PinSide, start: number, lane: number, power: (n: string) => boolean, wired: (n: string) => boolean): Member[] {
  const out: Member[] = []
  const horiz = dir === 'left' || dir === 'right'
  let cur = start
  for (const c of chain) {
    const [rot, flip] = orientFor(c.it, c.entry, OPPOSITE[dir])
    const net = c.it.pins.find(q => q.name === c.entry)?.net
    const bare = c.entry && net && wired(net) ? c.entry : undefined
    const e = symExtent(c.it, rot, flip, power, bare)
    const pin = c.entry ? pinAt(c.it, c.entry, rot, flip) : null
    const prev = c.pred && out.find(m => m.it === c.pred)
    const pp = prev && c.net ? prev.it.pins.find(q => q.net === c.net) : null
    const pe = prev && pp ? pinAt(prev.it, pp.name, prev.rot, prev.flip) : null
    const l = pe ? (horiz ? prev!.at[1] + pe.end[1] : prev!.at[0] + pe.end[0]) : lane
    const off = pin ? (horiz ? pin.end[1] : pin.end[0]) : 0
    let at: Pt
    if (dir === 'right') { at = [Math.ceil(cur - e[0]), l - off]; cur = at[0] + e[2] + GAP }
    else if (dir === 'left') { at = [Math.floor(cur - e[2]), l - off]; cur = at[0] + e[0] - GAP }
    else if (dir === 'bottom') { at = [l - off, Math.ceil(cur - e[1])]; cur = at[1] + e[3] + GAP }
    else { at = [l - off, Math.floor(cur - e[3])]; cur = at[1] + e[1] - GAP }
    out.push({ it: c.it, at, rot, flip, ...(bare ? { wired: bare } : {}) })
  }
  return out
}

const memberBox = (m: Member, power: (n: string) => boolean): Box => {
  const e = symExtent(m.it, m.rot, m.flip, power, m.wired)
  return [m.at[0] + e[0], m.at[1] + e[1], m.at[0] + e[2], m.at[1] + e[3]]
}
const unionBox = (bs: Box[]): Box => [Math.min(...bs.map(b => b[0])), Math.min(...bs.map(b => b[1])), Math.max(...bs.map(b => b[2])), Math.max(...bs.map(b => b[3]))]
const shift = (ms: Member[], d: Pt) => { for (const m of ms) m.at = [m.at[0] + d[0], m.at[1] + d[1]] }

/** An anchor with its chains on the sides of the pins they meet and its decoupling capacitors in a grid above or beside it. */
function anchorBlock(a: PlaceItem, flip: boolean, chains: { chain: ChainPart[]; pin: string; decap: boolean }[], power: (n: string) => boolean, wired: (n: string) => boolean): Block {
  const members: Member[] = [{ it: a, at: [0, 0], rot: 0, flip }]
  const ax = symExtent(a, 0, flip, power)
  const sides: Record<PinSide, { chain: ChainPart[]; end: Pt }[]> = { left: [], right: [], top: [], bottom: [] }
  const decaps: ChainPart[][] = []
  for (const c of chains) {
    if (c.decap) { decaps.push(c.chain); continue }
    const p = pinAt(a, c.pin, 0, flip)!
    sides[p.side].push({ chain: c.chain, end: p.end })
  }
  for (const side of ['left', 'right', 'top', 'bottom'] as PinSide[]) {
    const horiz = side === 'left' || side === 'right'
    const list = sides[side].sort((u, v) => (horiz ? u.end[1] - v.end[1] : u.end[0] - v.end[0]) || u.chain[0].it.order - v.chain[0].it.order)
    const out = side === 'left' || side === 'top' ? -1 : 1
    const limit = horiz ? ax[3] : ax[2]
    let start = side === 'left' ? ax[0] - GAP : side === 'right' ? ax[2] + GAP : side === 'top' ? ax[1] - GAP : ax[3] + GAP
    const along = (ms: Member[]) => { const b = unionBox(ms.map(m => memberBox(m, power))); return horiz ? [b[1], b[3]] : [b[0], b[2]] }
    const move = (ms: Member[], d: number) => shift(ms, horiz ? [0, d] : [d, 0])
    let next = -Infinity, far = start, col: Member[] = []
    for (const { chain, end } of list) {
      const lane = horiz ? end[1] : end[0]
      let ms = layChain(chain, side, start, lane, power, wired)
      const [lo] = along(ms)
      if (lo < next) move(ms, Math.ceil(next - lo))
      const over = Math.ceil(along(ms)[1] - limit)
      if (col.length && over > 0) {
        // past the anchor: lift the column toward its start, else begin a new column further out
        const lift = Math.min(over, Math.floor(along(col)[0] - (horiz ? ax[1] : ax[0])))
        if (lift >= over) { move(col, -over); move(ms, -over) }
        else { start = far + out * GAP; col = []; ms = layChain(chain, side, start, lane, power, wired) }
      }
      col.push(...ms)
      members.push(...ms)
      next = along(col)[1] + 1
      const nb = unionBox(ms.map(m => memberBox(m, power)))
      far = out < 0 ? Math.min(far, nb[horiz ? 0 : 1]) : Math.max(far, nb[horiz ? 2 : 3])
    }
  }
  if (decaps.length) {
    const caps = decaps.map(chain => { const [rot, flip] = orientFor(chain[0].it, chain[0].entry, 'top'); return { it: chain[0].it, rot, flip, e: symExtent(chain[0].it, rot, flip, power) } })
    const cw = Math.ceil(Math.max(...caps.map(d => d.e[2] - d.e[0]))) + 1, ch = Math.ceil(Math.max(...caps.map(d => d.e[3] - d.e[1]))) + 1
    const all = unionBox(members.map(m => memberBox(m, power)))
    const [w, h] = [ax[2] - ax[0], ax[3] - ax[1]]
    // above a wide anchor in rows, beside a tall one in columns on its emptier side
    const tall = h > 1.5 * w
    const across = tall ? Math.ceil(caps.length / Math.max(1, Math.floor(h / ch))) : Math.max(Math.floor(w / cw), Math.min(8, Math.ceil(caps.length / 2)), 1)
    const right = sides.right.length <= sides.left.length
    const x0 = !tall ? ax[0] : right ? Math.ceil(all[2]) + GAP : Math.floor(all[0]) - GAP - across * cw
    caps.forEach(({ it, rot, flip, e }, i) => {
      const x = x0 + (i % across) * cw, r = Math.floor(i / across)
      const at: Pt = tall ? [Math.ceil(x - e[0]), Math.ceil(ax[1] + r * ch - e[1])] : [Math.ceil(x - e[0]), Math.floor(all[1] - 1 - r * ch - e[3])]
      members.push({ it, at, rot, flip })
    })
  }
  return { ...toBlock(members, a, power, wired), mirror: () => anchorBlock(a, !flip, chains, power, wired) }
}

function toBlock(members: Member[], head: PlaceItem, power: (n: string) => boolean, wired: (n: string) => boolean): Block {
  const b = unionBox(members.map(m => memberBox(m, power)))
  const ext: Box = [Math.floor(b[0]), Math.floor(b[1]), Math.ceil(b[2]), Math.ceil(b[3])]
  const nets = new Set(members.flatMap(m => m.it.pins.map(q => q.net).filter((n): n is string => !!n && wired(n))))
  return { members, ext, nets, pins: head.sym.pins.length, order: Math.min(...members.map(m => m.it.order)), top: head.path[0] ?? '', conn: isConn(head) }
}

/** The blocks of a placement: every anchor with what links to it, then chains of the small parts left over. */
export function clusters(items: PlaceItem[], power: (n: string) => boolean, ground: (n: string) => boolean, wired: (n: string) => boolean = () => true): Block[] {
  const anchors = items.filter(it => it.sym.pins.length > 3 || (isConn(it) && it.sym.pins.length > 1))
  const links = linkSmalls(items, anchors, power, ground)
  const byNet = new Map<string, PlaceItem[]>()
  for (const it of items) for (const q of it.pins) if (q.net) byNet.set(q.net, [...(byNet.get(q.net) ?? []), it])
  const free = new Set(items.filter(it => !anchors.includes(it) && !links.has(it)))
  const chainsOf = new Map<PlaceItem, { chain: ChainPart[]; pin: string; decap: boolean }[]>()
  for (const it of items) {
    const l = links.get(it)
    if (!l) continue
    const net = l.anchor.pins.find(q => q.name === l.pin)?.net ?? null
    const entry = it.pins.find(q => q.net === net)?.name ?? null
    const chain = l.decap ? [{ it, entry, pred: null, net: null }] : chainFrom({ it, entry, pred: null, net: null }, free, byNet, power)
    chainsOf.set(l.anchor, [...(chainsOf.get(l.anchor) ?? []), { chain, pin: l.pin, decap: l.decap }])
  }
  const blocks: Block[] = []
  for (const a of anchors) blocks.push(anchorBlock(a, false, chainsOf.get(a) ?? [], power, wired))
  for (const it of items) {
    if (!free.has(it)) continue
    free.delete(it)
    const chain = chainFrom({ it, entry: null, pred: null, net: null }, free, byNet, power)
    const sig = it.pins.some(q => q.net && !power(q.net))
    const supply = sig ? null : it.pins.find(q => q.net && !ground(q.net))?.name ?? null
    if (supply && chain.length === 1) {
      const [rot, flip] = orientFor(it, supply, 'top')
      blocks.push(toBlock([{ it, at: [0, 0], rot, flip }], it, power, wired))
    } else blocks.push(toBlock(layChain(chain, 'right', 0, 0, power, wired), it, power, wired))
  }
  return blocks.sort((a, b) => a.order - b.order)
}

interface Rect { w: number; h: number; nets: Set<string> }
const gapOf = (a: Rect, b: Rect) => GAP + Math.min(CHANNEL_MAX, CHANNEL * shared(a.nets, b.nets))

/** Bottom-left packing in reading order: each rect at the topmost, then leftmost, free spot within `width`. */
export function pack(rects: Rect[], width: number, fixed: Box[] = []): Pt[] {
  const done: { r: Rect; b: Box }[] = []
  const out: Pt[] = []
  for (const r of rects) {
    const walls = [...done.map(d => ({ b: d.b, g: gapOf(r, d.r) })), ...fixed.map(b => ({ b, g: GAP }))]
    const xs = [...new Set([0, ...walls.map(w => w.b[2] + w.g)])].filter(x => x >= 0).sort((a, b) => a - b)
    const ys = [...new Set([0, ...walls.map(w => w.b[3] + w.g)])].filter(y => y >= 0).sort((a, b) => a - b)
    const free = (x: number, y: number) => walls.every(({ b, g }) => x >= b[2] + g || x + r.w <= b[0] - g || y >= b[3] + g || y + r.h <= b[1] - g)
    let at: Pt | null = null
    for (const y of ys) {
      for (const x of xs) if ((x === 0 || x + r.w <= width) && free(x, y)) { at = [x, y]; break }
      if (at) break
    }
    at ??= [0, Math.max(0, ...walls.map(w => w.b[3] + w.g))]
    done.push({ r, b: [at[0], at[1], at[0] + r.w, at[1] + r.h] })
    out.push(at)
  }
  return out
}

const pinsFirst = <T extends { pins: number; order: number }>(xs: T[]) => [...xs].sort((a, b) => b.pins - a.pins || a.order - b.order)
/** Greedy: the most pins first, then whatever shares the most nets with what is already placed. */
function linked<T extends { pins: number; order: number; nets: Set<string> }>(xs: T[]): T[] {
  const left = pinsFirst(xs), out: T[] = []
  const seen = new Set<string>()
  while (left.length) {
    let bi = 0, bn = -1
    left.forEach((x, i) => { const n = shared(x.nets, seen); if (n > bn) { bn = n; bi = i } })
    const [x] = left.splice(bi, 1)
    out.push(x)
    for (const n of x.nets) seen.add(n)
  }
  return out
}
const ordered = <T extends { pins: number; order: number; nets: Set<string> }>(xs: T[], how: PlaceOrder): T[] =>
  how === 'pins' ? pinsFirst(xs) : how === 'link' ? linked(xs) : [...xs].sort((a, b) => a.order - b.order)

/** A group's blocks packed into the width whose rectangle is smallest and nearest the paper's shape. */
function groupUnit(blocks: Block[], how: PlaceOrder, pad: boolean): Unit {
  const list = ordered(blocks, how)
  const rects = list.map(b => ({ w: b.ext[2] - b.ext[0], h: b.ext[3] - b.ext[1], nets: b.nets }))
  const most = Math.max(...rects.map(r => r.w))
  const sum = rects.reduce((t, r) => t + r.w + GAP, 0)
  const widths = [...new Set(Array.from({ length: 13 }, (_, i) => Math.round(most + (sum - most) * (i / 12) ** 2)))]
  let best: { offs: Pt[]; w: number; h: number; cost: number } | null = null
  for (const width of widths) {
    const offs = pack(rects, width)
    const w = Math.max(...offs.map((o, i) => o[0] + rects[i].w)), h = Math.max(...offs.map((o, i) => o[1] + rects[i].h))
    const cost = w * h * (1 + 0.5 * Math.abs(Math.log(w / h / 1.41)))
    if (!best || cost < best.cost) best = { offs, w, h, cost }
  }
  const [px, py] = pad ? [PAD, PAD_TOP] : [0, 0]
  return {
    blocks: list, offs: best!.offs.map(o => [o[0] + px, o[1] + py] as Pt), w: best!.w + 2 * px, h: best!.h + py + px,
    nets: new Set(list.flatMap(b => [...b.nets])), pins: Math.max(...list.map(b => b.pins)), order: Math.min(...list.map(b => b.order)),
  }
}

/** Places every item: clusters, group sheets packed inside, then everything packed into the free page, the smallest paper from `sheet` on, or the fixed one. */
export function place(input: PlaceInput): PlaceResult {
  const { items, power, ground, wired, grid, order } = input
  const at = new Map<string, Placement>()
  const { sheet } = input
  if (!items.length) return { at, paper: typeof sheet === 'number' ? PAPERS[sheet][0] : sheet ? 'custom' : null }
  const blocks = clusters(items, power, ground, wired)
  const groups = new Map<string, Block[]>()
  for (const b of blocks) groups.set(b.top, [...(groups.get(b.top) ?? []), b])
  const units: Unit[] = []
  for (const [top, bs] of groups) {
    if (top && bs.length) units.push(groupUnit(bs, order, true))
    else for (const b of bs) units.push(groupUnit([b], order, false))
  }
  const list = ordered(units, order)
  const fixed = input.fixed.map(b => [b[0] - MARGIN, b[1] - MARGIN, b[2] - MARGIN, b[3] - MARGIN] as Box)
  let offs: Pt[] | null = null, paper: string | null = sheet === null ? null : 'custom', width = 0
  const papers: [string, number, number][] = typeof sheet === 'number' ? PAPERS.slice(sheet) : sheet ? [['custom', ...sheet]] : []
  for (const [name, w, h] of papers) {
    const W = Math.floor(w / grid) - 2 * MARGIN - 2, H = Math.floor((h - TITLE) / grid) - 2 * MARGIN - 2
    const o = pack(list, W, fixed)
    if (list.every((u, i) => u.w <= W && o[i][1] + u.h <= H)) { offs = o; paper = name; width = W; break }
  }
  if (!offs) {
    const area = list.reduce((t, u) => t + (u.w + GAP) * (u.h + GAP), 0)
    width = Array.isArray(sheet) ? Math.max(...list.map(u => u.w), Math.floor(sheet[0] / grid) - 2 * MARGIN - 2) : Math.max(...list.map(u => u.w), Math.round(Math.sqrt(area * 1.41)))
    offs = pack(list, width, fixed)
  }
  const placed: { b: Block; o: Pt }[] = []
  list.forEach((u, i) => u.blocks.forEach((b, j) => placed.push({ b, o: [MARGIN + offs![i][0] + u.offs[j][0] - b.ext[0], MARGIN + offs![i][1] + u.offs[j][1] - b.ext[1]] })))
  faceEdges(placed, MARGIN + width / 2, input)
  for (const { b, o } of placed) for (const m of b.members) at.set(m.it.ref, { at: [o[0] + m.at[0], o[1] + m.at[1]], rot: m.rot, flip: m.flip })
  return { at, paper }
}

/** A connector whose pins all point one way turns them toward the middle of the sheet, its body to the nearer edge, where it fits. */
function faceEdges(placed: { b: Block; o: Pt }[], mid: number, input: PlaceInput) {
  const abs = (b: Block, o: Pt): Box => [o[0] + b.ext[0], o[1] + b.ext[1], o[0] + b.ext[2], o[1] + b.ext[3]]
  for (const p of placed) {
    const head = p.b.members[0]
    if (!p.b.conn || head.it.sym.pins.length < 2) continue
    const used = head.it.sym.pins.filter(q => head.it.pins.find(z => z.name === q.name)?.net)
    const sides = new Set(used.map(q => pinAt(head.it, q.name, head.rot, head.flip)!.side))
    if (sides.size !== 1 || !(sides.has('left') || sides.has('right'))) continue
    const box = abs(p.b, p.o)
    const inward = (box[0] + box[2]) / 2 < mid ? 'right' : 'left'
    if (sides.has(inward)) continue
    if (!p.b.mirror) continue
    const nb = p.b.mirror()
    const o: Pt = inward === 'left' ? [box[2] - nb.ext[2], p.o[1]] : [box[0] - nb.ext[0], p.o[1]]
    const b2 = abs(nb, o)
    const clear = placed.every(q => q === p || (() => { const c = abs(q.b, q.o); return b2[0] >= c[2] + 1 || b2[2] <= c[0] - 1 || b2[1] >= c[3] + 1 || b2[3] <= c[1] - 1 })())
      && input.fixed.every(c => b2[0] >= c[2] + 1 || b2[2] <= c[0] - 1 || b2[1] >= c[3] + 1 || b2[3] <= c[1] - 1)
    if (clear) { p.b = nb; p.o = o }
  }
}
