// The autorouter runs once per copper count under the strictest rules of the targets, unless a target sets `routeSeparately`.
import { h } from './jsx-runtime.js'
import { cloneData, deepFreeze } from './rules.js'
import { isBoundPCB, paletteName, type BoundPCB, type PresetBoardProps } from './preset.js'
import type { BoardProps, Finish, PcbNode, Rules, Stackup } from './types.js'

/** A target as a plain object; `board` is a partial board spec, such as `{ thickness: 1.2 }`. */
export interface VariantObject {
  name?: string
  board?: Partial<Omit<BoardProps, 'name' | 'children'>>
  rules?: Partial<Rules>
  /** mask colour of this target, overridden by the element's `color` */
  color?: string
  /** legend colour of this target, overridden by the element's `silk` */
  silk?: string
  finish?: Finish
  /** the fab this target goes to, for the viewer and README-fab */
  fab?: string
  /** the ordered sourcing tags of this target, such as `['US']`, overridden by the element's `sourcing` */
  sourcing?: readonly string[]
  /** README-fab notes of this target, before the element's `fabNotes` */
  fabNotes?: readonly string[]
  /** route under its own rules, not the strictest shared ones (default false) */
  routeSeparately?: boolean
}
/** One target of `variants(...)`: a fab preset such as `@pcbjs/fab/JLCPCB/2-Layer`, a plain object, or the plain `PCB` for the base. */
export type VariantTarget = BoundPCB | VariantObject | ((props: BoardProps) => PcbNode)

/** A target as the board node carries it, colours resolved. */
export interface VariantSpec {
  name: string
  fab?: string
  stackup?: Stackup
  rules?: Partial<Rules>
  color?: string
  silk?: string
  finish?: Finish
  /** the ordered sourcing tags of this target */
  sourcing?: readonly string[]
  board?: Partial<Omit<BoardProps, 'name' | 'children'>>
  /** routed under its own rules, not the shared strictest ones */
  routeSeparately?: boolean
}

export interface BoundVariants {
  (props: PresetBoardProps): PcbNode
  /** the targets in list order, as given, before the element's colours apply */
  readonly targets: readonly VariantSpec[]
}

interface Target { spec: VariantSpec; colors: Record<string, string> | null; silkColors: Record<string, string> | null }

function resolveTarget(t: VariantTarget, i: number): Target {
  if (isBoundPCB(t)) {
    const p = t.preset
    return {
      spec: { name: p.name || `Target ${i + 1}`, ...(p.fab ? { fab: p.fab } : {}), stackup: structuredClone(p.stackup) as Stackup, rules: { ...p.rules }, ...(p.sourcing ? { sourcing: [...p.sourcing] } : {}), ...(p.autoroute || p.classes || p.cpl || p.fabNotes ? { board: { ...(p.autoroute ? { autoroute: cloneData(p.autoroute) as any } : {}), ...(p.classes ? { classes: cloneData(p.classes) as any } : {}), ...(p.cpl ? { cpl: { ...p.cpl } } : {}), ...(p.fabNotes ? { fabNotes: [...p.fabNotes] } : {}) } } : {}) },
      colors: { ...p.colors }, silkColors: { ...p.silkColors },
    }
  }
  if (typeof t === 'function') {
    if (isVariants(t)) throw new TypeError(`variants: target ${i + 1} is itself a variants() component`)
    return { spec: { name: 'Base' }, colors: null, silkColors: null }
  }
  if (!t || typeof t !== 'object') throw new TypeError(`variants: target ${i + 1} must be a fab preset, an object or PCB, got ${JSON.stringify(t)}`)
  const spec: VariantSpec = { name: t.name ?? `Target ${i + 1}` }
  if (t.fab !== undefined) spec.fab = t.fab
  if (t.board) {
    const { stackup, rules, ...board } = t.board as any
    if (stackup) spec.stackup = structuredClone(stackup)
    if (rules) spec.rules = { ...rules }
    if (Object.keys(board).length) spec.board = cloneData(board)
  }
  if (t.rules) spec.rules = { ...(spec.rules ?? {}), ...t.rules }
  if (t.color !== undefined) spec.color = t.color
  if (t.silk !== undefined) spec.silk = t.silk
  if (t.finish !== undefined) spec.finish = t.finish
  if (t.sourcing !== undefined) spec.sourcing = [...t.sourcing]
  if (t.fabNotes !== undefined) {
    if (!Array.isArray(t.fabNotes)) throw new TypeError(`variants: target ${i + 1} fabNotes must be a list of lines`)
    spec.board = { ...(spec.board ?? {}), fabNotes: [...(spec.board?.fabNotes ?? []), ...t.fabNotes] }
  }
  if (t.routeSeparately !== undefined) {
    if (typeof t.routeSeparately !== 'boolean') throw new TypeError(`variants: target ${i + 1} routeSeparately must be true or false`)
    if (t.routeSeparately) spec.routeSeparately = true
  }
  return { spec, colors: null, silkColors: null }
}

const named = (palette: Record<string, string> | null, c: string | undefined) =>
  c === undefined || c === null ? undefined : palette ? paletteName(palette, String(c)) : String(c)

/** A <PCB> compiling the design once per target; names default to the preset's, else `Target N`, and must be unique. */
export function variants(...targets: VariantTarget[]): BoundVariants {
  if (!targets.length) throw new TypeError('variants() needs at least one target')
  const resolved = targets.map(resolveTarget)
  const specs = deepFreeze(resolved.map(r => ({ ...r.spec, ...(r.spec.color !== undefined ? { color: named(r.colors, r.spec.color) } : {}), ...(r.spec.silk !== undefined ? { silk: named(r.silkColors, r.spec.silk) } : {}) })))
  const Board = function (props: PresetBoardProps): PcbNode {
    const { children, color, silk, finish, ...rest } = props
    const list: VariantSpec[] = resolved.map(r => {
      const s: VariantSpec = cloneData(r.spec)
      const mask = named(r.colors, color ?? r.spec.color), legend = named(r.silkColors, silk ?? r.spec.silk)
      if (mask !== undefined) s.color = mask
      if (legend !== undefined) s.silk = legend
      if ((finish ?? r.spec.finish) !== undefined) s.finish = finish ?? r.spec.finish
      return s
    })
    return h('board', { ...rest, variants: list }, children as any)
  } as BoundVariants
  Object.defineProperty(Board, 'targets', { value: specs, enumerable: true })
  Object.defineProperty(Board, 'name', { value: 'PCB' })
  return Board
}

/** True for a component made by variants(). */
export function isVariants(fn: unknown): fn is BoundVariants {
  return typeof fn === 'function' && Array.isArray((fn as any).targets)
}

/** A target name in lowercase with every other run of characters a `-`. */
export function variantSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

/** The stackup with its mask and legend colours and finish replaced. */
export function recolor(s: Stackup, mask?: string, silk?: string, finish?: Finish): Stackup {
  if (mask === undefined && silk === undefined && finish === undefined) return s
  const out: Stackup = { ...s, layers: s.layers.map(l => {
    if (mask !== undefined && l.type === 'mask') return { ...l, color: mask }
    if (silk !== undefined && l.type === 'silk') return { ...l, color: silk }
    return l
  }) }
  if (mask !== undefined) out.maskColor = mask
  if (silk !== undefined) out.silkColor = silk
  if (finish !== undefined) out.finish = finish
  return out
}
