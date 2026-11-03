// The 2D highlight as markup: copies of the layer elements a state names, one class per state, drawn over every layer.
// Free of Vue and the DOM, written as erasable TypeScript so Node imports it in the tests.
import type { SiteData } from '@pcbjs/core/site-data'

/** hover, selected, anchor, context, stale; `focus` rings the finding in focus. */
export type Hl2d = 'hover' | 'sel' | 'anchor' | 'ctx'
export interface Layer2d {
  state: Hl2d
  parts?: Iterable<string>
  ids?: Iterable<number>
  nets?: Iterable<string>
  /** item ids drawn half-opaque with a dashed outline */
  stale?: ReadonlySet<number>
}

interface El {
  layer: string
  kind: string
  tag: string
  /** the geometry attributes, verbatim */
  geom: string
  id: number | null
  net: string | null
  ref: string | null
  /** a stroked line's width in mm, 0 for a filled shape */
  sw: number
}
type Site = Pick<SiteData, 'layers' | 'footprints'>

const GEOM = /\b(d|cx|cy|r|x|y|width|height|rx|transform|fill-rule|stroke-linecap|stroke-linejoin)="[^"]*"/g
const attr = (s: string, k: string) => new RegExp(`\\b${k}="([^"]*)"`).exec(s)?.[1] ?? null
const unesc = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')

const indexes = new WeakMap<object, El[]>()
/** Every element of every layer with an id or a ref, parsed once per layers facet. */
function elements(site: Site): El[] {
  let out = indexes.get(site.layers)
  if (out) return out
  out = []
  for (const l of site.layers)
    for (const m of l.svg.matchAll(/<(path|circle|rect)\b([^>]*?)\/?>/g)) {
      const a = m[2]
      const id = attr(a, 'data-id'),
        ref = attr(a, 'data-ref')
      if (id === null && ref === null) continue
      const net = attr(a, 'data-net')
      out.push({
        layer: l.id,
        kind: l.kind,
        tag: m[1],
        geom: [...a.matchAll(GEOM)].map(g => g[0]).join(' '),
        id: id === null ? null : +id,
        net: net === null ? null : unesc(net),
        ref: ref === null ? null : unesc(ref),
        sw: attr(a, 'fill') === 'none' ? +(attr(a, 'stroke-width') ?? 0) : 0,
      })
    }
  indexes.set(site.layers, out)
  return out
}

/** The markup of the highlight overlay for the states in drawing order, on the visible layers; copper first, else any visible layer. */
export function overlay(site: Site, visible: ReadonlySet<string>, states: readonly Layer2d[]): string {
  const els = elements(site).filter(e => visible.has(e.layer))
  const colour = new Map(site.layers.map(l => [l.id, l.color]))
  const copper = els.filter(e => e.kind === 'copper')
  const out: string[] = []
  for (const s of states) {
    const ids = new Set(s.ids ?? []),
      nets = new Set(s.nets ?? []),
      parts = new Set(s.parts ?? [])
    const items = (copper.some(e => e.id !== null && ids.has(e.id)) ? copper : els).filter(e => e.id !== null && ids.has(e.id) && e.kind !== 'courtyard')
    const netEls = nets.size ? copper.filter(e => e.net !== null && nets.has(e.net)) : []
    for (const e of [...items, ...netEls]) out.push(clone(e, s.state, colour.get(e.layer) ?? 'currentColor', !!(e.id !== null && s.stale?.has(e.id))))
    for (const ref of parts) {
      const crt = els.filter(e => e.kind === 'courtyard' && e.ref === ref)
      if (crt.length) for (const e of crt) out.push(...shape(e.tag, e.geom, s.state, false, ref))
      else {
        const b = site.footprints.find(f => f.ref === ref)?.bbox
        if (b) out.push(...shape('rect', `x="${f(b.x - 0.25)}" y="${f(b.y - 0.25)}" width="${f(b.w + 0.5)}" height="${f(b.h + 0.5)}"`, s.state, false, ref))
      }
    }
  }
  return out.join('')
}

const f = (v: number) => String(Math.round(v * 1e4) / 1e4)
const CASED = new Set<Hl2d>(['sel', 'anchor'])

/** A filled shape or a courtyard outline: a casing under the selected states, then the state's outline over its 10 percent tint. */
function shape(tag: string, geom: string, state: Hl2d, stale: boolean, of: string): string[] {
  const cls = `hl-${state}${stale ? ' hl-stale' : ''}`
  const out = CASED.has(state) ? [`<${tag} class="hl-case hl-case-${state}" ${geom}/>`] : []
  out.push(`<${tag} class="${cls}" data-hl="${esc(of)}" ${geom}/>`)
  return out
}
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/** A copy of one element; a stroked track keeps its width, the outline drawn as a wider copy under one at the true width in its layer colour. */
function clone(e: El, state: Hl2d, colour: string, stale: boolean): string {
  const of = String(e.id ?? e.ref)
  if (!e.sw) return shape(e.tag, e.geom, state, stale, of).join('')
  const w = f(e.sw)
  const cls = `hl-${state} hl-line${stale ? ' hl-stale' : ''}`
  const under = CASED.has(state) ? `<${e.tag} class="hl-case hl-case-${state} hl-line" style="--w:${w}px" ${e.geom}/>` : ''
  return `${under}<${e.tag} class="${cls}" data-hl="${of}" style="--w:${w}px" ${e.geom}/><${e.tag} class="hl-in hl-in-${state}" style="--w:${w}px;--c:${colour}" ${e.geom}/>`
}

/** What an overlay drew, item ids and part refs, by state class with ` hl-stale` for a stale one, read back from its markup. */
export function statesOf(markup: string): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const m of markup.matchAll(/class="(hl-(?:hover|sel|anchor|ctx))([^"]*)" data-hl="([^"]*)"/g)) {
    const key = m[1] + (m[2].includes('hl-stale') ? ' hl-stale' : '')
    out.set(key, [...(out.get(key) ?? []), m[3]])
  }
  return out
}
