// What every view draws for a selection, a hover, an isolation and an edit, as one value, and the one copy of the hover glue that turns
// what is under the pointer into what a click would select. paintOf is pure; the selection rule itself stays in ./selection.
import { computed, onBeforeUnmount, watch, type ComputedRef } from 'vue'
import { NONE, type Stale } from './live'
import { netRoles } from './routes'
import { clickTarget, drawnOf, hoverOf, type Drawn, type Hit, type IsolationView, type Ref, type Selection, type Site } from './selection'
import type { HoverTarget } from './sync'

/** Items, parts and nets drawn in one state. */
export interface Lit {
  ids: ReadonlySet<number>
  parts: ReadonlySet<string>
  nets: ReadonlySet<string>
}
export interface Paint {
  hover: Lit
  /** the members but the anchor */
  sel: Lit
  anchor: Lit
  /** the anchor's net and its pair mates */
  ctx: Lit
  /** the focus fade is on and the selection draws something: what is neither selected nor context fades */
  fade: boolean
  iso: IsolationView | null
  stale: Stale
  /** hidden layers */
  hidden: ReadonlySet<string>
}

export const DARK: Lit = { ids: new Set(), parts: new Set(), nets: new Set() }
const empty = (l: Lit) => !l.ids.size && !l.parts.size && !l.nets.size
const litOf = (parts: Iterable<string>, ids: Iterable<number>, nets: Iterable<string>): Lit => {
  const l = { ids: new Set(ids), parts: new Set(parts), nets: new Set(nets) }
  return empty(l) ? DARK : l
}
/** The union of lit sets. */
export function union(...ls: Lit[]): Lit {
  const out = ls.filter(l => !empty(l))
  if (out.length < 2) return out[0] ?? DARK
  return litOf(
    out.flatMap(l => [...l.parts]),
    out.flatMap(l => [...l.ids]),
    out.flatMap(l => [...l.nets]),
  )
}

type Parts = { sel: Lit; anchor: Lit; ctx: Lit }
// the same sets while the drawn selection and the board are, so a view tells what changed by identity
const parts = new WeakMap<Drawn, { site: Site; out: Parts }>()
function partsOf(site: Site, d: Drawn): Parts {
  const hit = parts.get(d)
  if (hit?.site === site) return hit.out
  const rest = <T>(s: Set<T>, a: Set<T>) => [...s].filter(x => !a.has(x))
  const out = {
    sel: litOf(rest(d.parts, d.anchor.parts), rest(d.ids, d.anchor.ids), rest(d.nets, d.anchor.nets)),
    anchor: litOf(d.anchor.parts, d.anchor.ids, d.anchor.nets),
    ctx: d.context ? litOf([], [], netRoles(site, d.context).keys()) : DARK,
  }
  parts.set(d, { site, out })
  return out
}

/** The paint of a view: the selection drawn as `sel`, `anchor` and `ctx`, the hover, the isolation, what the last edit made stale and the hidden layers. */
export function paintOf(site: Site, sel: Drawn | null, hover: Lit, iso: IsolationView | null, stale: Stale | undefined, hidden: ReadonlySet<string>, fade: boolean): Paint {
  const p = sel ? partsOf(site, sel) : { sel: DARK, anchor: DARK, ctx: DARK }
  const draws = !!sel && (!!(sel.ids.size || sel.parts.size || sel.nets.size) || !!sel.context)
  return { hover, ...p, fade: fade && draws, iso, stale: stale ?? NONE, hidden }
}

/** Everything a fade keeps: the members and the context. */
export const keptOf = (p: Paint): Lit => union(p.sel, p.anchor, p.ctx)

/** What a hover draws: what a click would select now unless it is a member already, another viewer's hover and a net or parts hovered in a panel. */
export function hoverLit(site: Site, sel: Selection, target: Ref | null, more: { remote?: HoverTarget | null; net?: string | null; refs?: readonly string[] } = {}): Lit {
  const out: Lit[] = []
  if (target && !sel.refs.includes(target)) {
    const d = drawnOf(site, { ...sel, refs: [target], anchor: target, marks: undefined })
    out.push(litOf(d.parts, d.ids, d.nets))
  }
  const far = more.remote
  if (far) out.push(litOf(far.ids.length ? [] : far.refs, far.ids, []))
  if (more.net || more.refs?.length) out.push(litOf(more.refs ?? [], [], more.net ? [more.net] : []))
  return union(...out)
}

/** Whether two lit sets hold the same members. */
export function sameLit(a: Lit, b: Lit): boolean {
  const eq = <T>(x: ReadonlySet<T>, y: ReadonlySet<T>) => x === y || (x.size === y.size && [...x].every(v => y.has(v)))
  return a === b || (eq(a.ids, b.ids) && eq(a.parts, b.parts) && eq(a.nets, b.nets))
}

/** The members of `a` not in `b` and of `b` not in `a`, as one set. */
export function changedLit(a: Lit, b: Lit): Lit {
  if (a === b) return DARK
  const diff = <T>(x: ReadonlySet<T>, y: ReadonlySet<T>) => [...[...x].filter(v => !y.has(v)), ...[...y].filter(v => !x.has(v))]
  return litOf(diff(a.parts, b.parts), diff(a.ids, b.ids), diff(a.nets, b.nets))
}

export interface HoverView {
  /** what is under the pointer */
  hit: () => Hit | null
  site: () => Site
  sel: () => Selection
  /** cmd or ctrl held */
  deep: () => boolean
  /** where the view puts what the pointer is on */
  hover: { item: HoverTarget | null }
}
/** What a click would select under the pointer, with cmd or ctrl held what a deep-select would; the other views and viewers light it as the hover, nothing more. `on` hears it as it changes and null as the view goes. */
export function useHover(view: HoverView, on?: (h: HoverTarget | null) => void): ComputedRef<Ref | null> {
  const target = computed(() => clickTarget(view.sel(), view.site(), view.hit(), view.deep()))
  watch(target, t => {
    const h = t ? hoverOf(view.site(), t) : null
    view.hover.item = h
    on?.(h)
  })
  onBeforeUnmount(() => {
    view.hover.item = null
    on?.(null)
  })
  return target
}
