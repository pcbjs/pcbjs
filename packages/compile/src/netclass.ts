// The class table, its checks and merge are in @pcbjs/core, re-exported here.
import type { Board, Item, KindClearanceMM, Pad } from '@pcbjs/core/model'
import type { ResolvedNetClass } from '@pcbjs/core/netclass'

export { CLASS_DEFAULTS, checkClasses, checkCorner, checkNeck, mergeClasses, resolveClasses, type ResolvedNetClass } from '@pcbjs/core/netclass'

/** net name -> its resolved class, per board, from the netlist's class tags and the board's class table */
const NET_CLASSES = new WeakMap<Board, Map<string, ResolvedNetClass>>()
/** net name -> the name of its class, per board, for messages */
const NET_CLASS_NAMES = new WeakMap<Board, Map<string, string>>()
function netClasses(board: Board): Map<string, ResolvedNetClass> {
  let m = NET_CLASSES.get(board)
  if (!m) {
    m = new Map()
    const names = new Map<string, string>()
    const t = board.classes
    if (t) for (const n of board.schematic?.nets ?? []) if (n.class && t[n.class]) { m.set(n.name, t[n.class]); names.set(n.name, n.class) }
    NET_CLASSES.set(board, m)
    NET_CLASS_NAMES.set(board, names)
  }
  return m
}
/** The name of a net's class, or undefined. */
export function classNameOf(board: Board, net: string | undefined): string | undefined {
  if (net === undefined || !board.classes) return undefined
  netClasses(board)
  return NET_CLASS_NAMES.get(board)?.get(net)
}

/** The resolved class of a net, or undefined when the net has no class or its class is not in the board's table. */
export function classOf(board: Board, net: string | undefined): ResolvedNetClass | undefined {
  return net === undefined || !board.classes ? undefined : netClasses(board).get(net)
}

/** The clearance a net's copper asks of other nets: its class clearance, else the rules'; the larger of two holds. */
export function netClearance(board: Board, net: string | undefined, rules: { clearance: number } = board.rules): number {
  return classOf(board, net)?.clearance ?? rules.clearance
}

/** The copper clearance between two nets, the larger of what each asks; callers skip same-net pairs, an undefined net is no net. */
export function classClearance(board: Board, netA: string | undefined, netB: string | undefined): number {
  return Math.max(netClearance(board, netA), netClearance(board, netB))
}

/** The largest class clearance on the board, kind scoped ones included, or the rules' clearance when that is larger. */
export function maxClassClearance(board: Board): number {
  let c = board.rules.clearance
  if (board.classes) for (const k of Object.values(board.classes)) {
    if (k.clearance !== undefined && k.clearance > c) c = k.clearance
    if (k.clearanceTo) c = Math.max(c, kindMax(k.clearanceTo))
  }
  return c
}

/** The largest value of a clearance by kind, pad types included; 0 for none. */
export function kindMax(t: KindClearanceMM): number {
  let c = 0
  for (const v of Object.values(t)) {
    if (typeof v === 'number') c = Math.max(c, v)
    else if (v) c = Math.max(c, v.tht ?? 0, v.smd ?? 0)
  }
  return c
}

/** A kind clearance toward an item, by pad type toward a pad; undefined when none applies, so an NPTH skips pad type clearances. */
export function kindToward(t: KindClearanceMM, it: { kind: string; type?: string }): { v: number; scope: string } | undefined {
  const k = clearanceKind(it)
  if (!k) return undefined
  const v = t[k]
  if (v === undefined) return undefined
  if (typeof v === 'number') return { v, scope: k }
  const p = it.type === 'tht' || it.type === 'smd' ? v[it.type] : undefined
  return p !== undefined ? { v: p, scope: `${it.type} pad` } : undefined
}

/** True when a class of the board scopes its clearance by kind. */
export function hasKindClasses(board: Board): boolean {
  return !!board.classes && Object.values(board.classes).some(k => !!k.clearanceTo)
}

/** The largest clearance any pair of items on the board needs: the classes', the rules' and every pad override's. */
export function maxClearance(board: Board): number {
  return Math.max(maxClassClearance(board), padOverrides(board).clearance)
}

/** The largest hole clearance any hole and copper on the board need: the rules' and every pad override's. */
export function maxHoleClearance(board: Board): number {
  return Math.max(board.rules.holeClearance, padOverrides(board).holeClearance)
}

/** The largest pad overrides of a board, per board, made again when the item count changes. */
const PAD_MAX = new WeakMap<Board, { n: number; clearance: number; holeClearance: number; any: boolean }>()
function padOverrides(board: Board): { clearance: number; holeClearance: number; any: boolean } {
  let m = PAD_MAX.get(board)
  if (!m || m.n !== board.items.length) {
    m = { n: board.items.length, clearance: 0, holeClearance: 0, any: false }
    for (const it of board.items) if (it.kind === 'pad' && it.override) {
      m.any = true
      if (it.clearance !== undefined && it.clearance > m.clearance) m.clearance = it.clearance
      if (it.clearanceTo) m.clearance = Math.max(m.clearance, kindMax(it.clearanceTo))
      if (it.holeClearance !== undefined && it.holeClearance > m.holeClearance) m.holeClearance = it.holeClearance
    }
    PAD_MAX.set(board, m)
  }
  return m
}
/** True when a pad of the board carries a rule override. */
export const hasPadOverrides = (board: Board): boolean => padOverrides(board).any

/** What the rules ask of one item: a copper item with the net, and a pad with its overrides and its footprint. */
type Ask = { kind: string; net?: string; ref?: string; type?: string; clearance?: number; clearanceTo?: KindClearanceMM; holeClearance?: number }

/** The kinds of item a clearance may be scoped to, see KindClearance in @pcbjs/core/types. */
export type ClearanceKind = 'pad' | 'track' | 'via' | 'zone' | 'text'
/** The kind an item counts as for a kind scoped clearance, or undefined for one no kind names, such as a copper graphic. */
export function clearanceKind(it: { kind: string }): ClearanceKind | undefined {
  const k = it.kind
  return k === 'pad' || k === 'track' || k === 'via' || k === 'zone' || k === 'text' ? k : undefined
}

/** The override an item asks toward another and where it comes from, see itemClearance; undefined when none applies. */
type Toward = { v: number; from: 'pad' | 'class'; scope?: string }
function overrideToward(board: Board, a: Ask, b: Ask): Toward | undefined {
  if (a.kind === 'pad') {
    if (a.clearance !== undefined) return { v: a.clearance, from: 'pad' }
    const t = a.clearanceTo
    if (!t) return undefined
    if (b.kind === 'pad' && a.ref !== undefined && a.ref === b.ref) return t.self !== undefined ? { v: t.self, from: 'pad', scope: 'self' } : undefined
    const o = kindToward(t, b)
    return o ? { v: o.v, from: 'pad', scope: o.scope } : undefined
  }
  if ((a.kind === 'track' || a.kind === 'via') && board.classes) {
    const t = classOf(board, a.net)?.clearanceTo
    const o = t && kindToward(t, b)
    if (o) return { v: o.v, from: 'class', scope: o.scope }
  }
  return undefined
}

/** The larger override between two items, a pad's own, part or `self` clearance or a track's or via's kind-scoped class clearance; undefined for none. */
export function overrideBetween(board: Board, a: Ask, b: Ask): number | undefined {
  const oa = overrideToward(board, a, b), ob = overrideToward(board, b, a)
  return oa || ob ? Math.max(oa?.v ?? 0, ob?.v ?? 0) : undefined
}

/** A pad's clearance override toward an item of a kind on another footprint, or undefined. */
export function padClearanceTo(p: { clearance?: number; clearanceTo?: KindClearanceMM }, kind: Exclude<ClearanceKind, 'pad'>): number | undefined {
  return p.clearance ?? p.clearanceTo?.[kind]
}

/** The clearance an item asks of other nets: a pad's own override, else its part's, else its net class, else the rules. */
export function ownClearance(board: Board, it: Ask, rules: { clearance: number } = board.rules): number {
  return it.kind === 'pad' && it.clearance !== undefined ? it.clearance : netClearance(board, it.net, rules)
}

/** The hole clearance an item asks: a pad's override, else the rules'. */
export function ownHoleClearance(it: Ask, rules: { holeClearance: number }): number {
  return it.kind === 'pad' && it.holeClearance !== undefined ? it.holeClearance : rules.holeClearance
}

/** Where an item's clearance comes from, for a finding: `pad override of J1.3`, `part override of J1`, `class power`, or '' for the rules. */
export function clearanceSource(board: Board, it: Item, key: 'clearance' | 'holeClearance' | 'edgeClearance' | 'trackWidth' = 'clearance'): string {
  if (it.kind === 'pad' && (it[key] !== undefined || (key === 'clearance' && it.clearanceTo))) {
    const lvl = (it as Pad).override?.[key]
    return lvl === 'part' ? `part override of ${it.ref ?? 'its part'}` : `pad override of ${it.ref ?? ''}${it.num ? `.${it.num}` : ''}`
  }
  if (key !== 'clearance') return ''
  const c = classNameOf(board, it.net)
  return c !== undefined && classOf(board, it.net)?.clearance !== undefined ? `class ${c}` : ''
}

/** The source of the clearance that holds between two items, see itemClearance; '' when it is the rules'. */
export function pairSource(board: Board, a: Item, b: Item, rules: { clearance: number } = board.rules): string {
  const oa = overrideToward(board, a, b), ob = overrideToward(board, b, a)
  if (oa || ob) {
    const [it, o] = !ob || (oa && oa.v >= ob.v) ? [a, oa!] : [b, ob]
    const to = o.scope === 'self' ? ', to its own pads' : o.scope ? `, to ${o.scope}s` : ''
    return (o.from === 'class' ? `class ${classNameOf(board, it.net)}` : clearanceSource(board, it)) + to
  }
  const ca = ownClearance(board, a, rules), cb = ownClearance(board, b, rules)
  return clearanceSource(board, ca >= cb ? a : b) || (ca === cb ? clearanceSource(board, b) : '')
}

/** The gap of each differential pair by its two nets, as the router lays them out, per board. */
const PAIR_GAPS = new WeakMap<Board, Map<string, number>>()
const pairKey = (a: string, b: string) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`)
/** Records the two nets of a differential pair and its gap; the router calls it before routing, DRC reads board.pairs too. */
export function notePair(board: Board, a: string, b: string, gap: number): void {
  let m = PAIR_GAPS.get(board)
  if (!m) PAIR_GAPS.set(board, m = new Map())
  const k = pairKey(a, b), g = m.get(k)
  m.set(k, g === undefined ? gap : Math.min(g, gap))
}
/** The gap of the pair the two nets form, or undefined when they form none. */
export function pairGapOf(board: Board, a: string | undefined, b: string | undefined): number | undefined {
  if (a === undefined || b === undefined || a === b) return undefined
  const g = PAIR_GAPS.get(board)?.get(pairKey(a, b))
  if (g !== undefined) return g
  let out: number | undefined
  for (const p of board.pairs ?? []) if ((p.nets[0] === a && p.nets[1] === b) || (p.nets[0] === b && p.nets[1] === a)) out = out === undefined ? p.gap : Math.min(out, p.gap)
  return out
}
/** The clearance between two items as KiCad resolves it: an override wins outright, else the larger class or rules clearance, a pair gap where smaller but not below the rules'. */
export function itemClearance(board: Board, a: Ask, b: Ask, rules: { clearance: number } = board.rules): number {
  const o = overrideBetween(board, a, b)
  if (o !== undefined) return o
  const c = Math.max(ownClearance(board, a, rules), ownClearance(board, b, rules))
  if ((a.kind !== 'track' && a.kind !== 'via') || (b.kind !== 'track' && b.kind !== 'via')) return c
  const g = pairGapOf(board, a.net, b.net)
  return g === undefined ? c : Math.max(rules.clearance, Math.min(c, g - 0.002))
}
