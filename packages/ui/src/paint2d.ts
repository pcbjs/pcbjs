// The 2D view's Paint on its SVG layers: ordinary and lit passes retain layer order, with the entity grid between them.
// An isolation and stale items toggle classes through an id to element map built once per layers
// facet, touching only what differs from the last Paint.
import type { Paint } from './paint'

interface Index {
  ids: Map<number, SVGElement[]>
  refs: Map<string, SVGElement[]>
  nets: Map<string, SVGElement[]>
  /** every tagged element, in document order */
  all: SVGElement[]
  order: Map<SVGElement, number>
  edge: Set<SVGElement>
  dest: Map<SVGElement, SVGGElement>
}

const push = <K>(m: Map<K, SVGElement[]>, k: K, el: SVGElement) => {
  const l = m.get(k)
  if (l) l.push(el)
  else m.set(k, [el])
}
const PAINTED = ['stale', 'gone', 'iso-out', 'iso-fade', 'lifted']
const sameSet = <T>(a: ReadonlySet<T> | undefined, b: ReadonlySet<T> | undefined) => a === b || (!!a && !!b && a.size === b.size && [...a].every(x => b.has(x)))

export class Paint2d {
  private ix: Index | null = null
  private layers: unknown = null
  private prev: Paint | null = null
  private lit = new Set<Element>()
  private lifted = new Set<SVGElement>()
  private content: () => SVGGElement | null
  /** counts the indexes and the lit copies made, so a list of elements found under one count still holds */
  gen = 0
  constructor(content: () => SVGGElement | null) {
    this.content = content
  }

  /** The tagged elements of every layer group, by id, part and net. */
  private index(root: SVGGElement): Index {
    const ix: Index = { ids: new Map(), refs: new Map(), nets: new Map(), all: [], order: new Map(), edge: new Set(), dest: new Map() }
    const lit = new Map([...root.querySelectorAll<SVGGElement>(':scope > g.layer.lit')].map(g => [g.dataset.layer, g]))
    for (const g of root.querySelectorAll<SVGGElement>(':scope > g.layer:not(.lit)')) {
      const edge = g.dataset.kind === 'edge'
      const target = lit.get(g.dataset.layer)
      for (const el of g.querySelectorAll<SVGElement>('[data-id], [data-ref]')) {
        const d = el.dataset
        if (d.id) push(ix.ids, +d.id, el)
        if (d.ref) push(ix.refs, d.ref, el)
        if (d.net) push(ix.nets, d.net, el)
        // an element a new facet left as it was keeps the classes the last paint gave it
        el.classList.remove(...PAINTED)
        ix.order.set(el, ix.all.length)
        ix.all.push(el)
        if (edge) ix.edge.add(el)
        else if (target) ix.dest.set(el, target)
      }
    }
    return ix
  }

  /** The elements of these items, parts and nets. */
  private els(ids: Iterable<number>, parts: Iterable<string>, nets: Iterable<string>): Set<SVGElement> {
    const ix = this.ix!,
      out = new Set<SVGElement>()
    for (const id of ids) for (const el of ix.ids.get(id) ?? []) out.add(el)
    for (const r of parts) for (const el of ix.refs.get(r) ?? []) out.add(el)
    for (const n of nets) for (const el of ix.nets.get(n) ?? []) out.add(el)
    return out
  }

  /** Draw a paint; `layers` names the layers facet drawn, a new one indexed again and painted whole. */
  apply(p: Paint, layers: unknown) {
    if (!this.ensure(layers)) return
    const prev = this.prev
    this.prev = p
    const iso = !prev || p.iso !== prev.iso
    const stale = !prev || p.stale !== prev.stale
    if (iso) this.isolate(p, prev)
    if (stale) this.mark(p, prev)
    if (iso || stale || !prev || p.fade !== prev.fade || p.sel !== prev.sel || p.anchor !== prev.anchor || p.ctx !== prev.ctx) this.redraw(p)
  }
  /** The index of the layers facet drawn, made again for a new one, which a paint then draws whole; false with no content. */
  private ensure(layers: unknown): boolean {
    const root = this.content()
    if (!root) return false
    if (layers !== this.layers || !this.ix) {
      this.layers = layers
      this.ix = this.index(root)
      for (const g of root.querySelectorAll(':scope > g.layer.lit')) g.replaceChildren()
      this.lit.clear()
      this.lifted.clear()
      this.prev = null
      this.gen++
    }
    return true
  }

  /** The elements of these parts and of these items of no part, their lit copies among them, `skip` left out. */
  posed(parts: ReadonlySet<string>, ids: ReadonlySet<number>, skip: ReadonlySet<number>, layers: unknown): SVGElement[] {
    if (!this.ensure(layers)) return []
    const ix = this.ix!
    const mine = (el: SVGElement) => {
      const d = el.dataset
      return !skip.has(Number(d.id)) && (d.ref ? parts.has(d.ref) : ids.has(Number(d.id)))
    }
    const out: SVGElement[] = []
    for (const r of parts) for (const el of ix.refs.get(r) ?? []) if (mine(el)) out.push(el)
    for (const id of ids) for (const el of ix.ids.get(id) ?? []) if (mine(el)) out.push(el)
    for (const g of this.lit) for (const el of g.querySelectorAll<SVGElement>('[data-id], [data-ref]')) if (mine(el)) out.push(el)
    return out
  }

  /** The lit items drawn again from where they stand now, as after a drag's preview clears. */
  refresh() {
    if (this.prev) this.redraw(this.prev)
  }

  /** An isolation hides or fades what it leaves out, the outline with the board: only the elements whose side of it changed. */
  private isolate(p: Paint, prev: Paint | null) {
    const ix = this.ix!,
      a = prev?.iso ?? null,
      b = p.iso
    const whole = !a || !b || a.fade !== b.fade || !!a.frame !== !!b.frame
    const touched = whole ? ix.all : [...this.els(new Set([...a.ids, ...b.ids]), new Set([...a.parts, ...b.parts]), [])]
    for (const el of touched) {
      const d = el.dataset
      const out = !!b && (ix.edge.has(el) ? !!b.frame : !(d.id && b.ids.has(+d.id)) && !(d.ref && b.parts.has(d.ref)))
      el.classList.toggle('iso-out', out && !b!.fade)
      el.classList.toggle('iso-fade', out && b!.fade)
    }
  }

  /** What the last edit made stale drawn half-opaque, and what a sketch stands in for hidden: only the items that changed. */
  private mark(p: Paint, prev: Paint | null) {
    const was = prev?.stale
    if (was && sameSet(was.ids, p.stale.ids) && sameSet(was.gone, p.stale.gone)) return
    const ids = new Set([...(was?.ids ?? []), ...(was?.gone ?? []), ...p.stale.ids, ...p.stale.gone])
    for (const id of ids)
      for (const el of this.ix!.ids.get(id) ?? []) {
        el.classList.toggle('stale', p.stale.ids.has(id))
        el.classList.toggle('gone', p.stale.gone.has(id))
      }
  }

  /** Kept elements draw above the grid in their matching lit layers, with their originals hidden. */
  private redraw(p: Paint) {
    const by = new Map<Element, SVGElement[]>(),
      lifted = new Set<SVGElement>()
    const ix = this.ix!
    const kept = [p.sel, p.anchor, p.ctx]
    const els = this.els(
      kept.flatMap(l => [...l.ids]),
      kept.flatMap(l => [...l.parts]),
      kept.flatMap(l => [...l.nets]),
    )
    for (const el of [...els].sort((x, y) => ix.order.get(x)! - ix.order.get(y)!)) {
      const lit = ix.dest.get(el)
      if (!lit) continue
      const l = by.get(lit)
      if (l) l.push(el)
      else by.set(lit, [el])
      lifted.add(el)
    }
    for (const g of this.lit) if (!by.has(g)) g.replaceChildren()
    for (const [g, els] of by) g.replaceChildren(...els.map(copy))
    this.lit = new Set(by.keys())
    this.gen++
    for (const el of this.lifted) if (!lifted.has(el)) el.classList.remove('lifted')
    for (const el of lifted) el.classList.add('lifted')
    this.lifted = lifted
  }
}

/** An element as the lit group draws it: its classes and its preview transform kept, shown. */
function copy(el: SVGElement): Node {
  const c = el.cloneNode(true) as SVGElement
  c.classList.remove('lifted')
  return c
}
