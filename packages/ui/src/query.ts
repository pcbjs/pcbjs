// read once at startup and applied after the first render, so a prerendered page hydrates as the server rendered it

import { LAYER_ALIASES } from '@pcbjs/core/internal/layers'
import type { ViewName } from '@pcbjs/core/site-facets'
import type { Side } from './sides'

/** The largest layer separation of the exploded 3D view in mm, the end of its slider; `explode=1` asks for it. */
export const EXPLODE_MAX = 15

export interface ViewQuery {
  /** the view to open in, null for the default */
  view: ViewName | null
  /** the exploded 3D view at this fraction of EXPLODE_MAX, null to leave it as it is */
  explode: number | null
  /** the layer to show alone in 2D, as given */
  layer: string | null
  /** what to select, references of docs/refs.md as a comma list, the anchor first */
  select: string | null
  /** the group or part to isolate */
  isolate: string | null
  isolateMode?: 'instance' | 'library' | null
  focus?: string | null
  /** the side on top in 2D, B also opening 3D under the board; null for the default, F */
  side: Side | null
  /** the 2D view mirrored horizontally; null for the default, off */
  mirror: boolean | null
  theme: 'light' | 'dark' | null
}

/** Read the view query from a location's search string; values that do not parse are dropped. */
export function parseViewQuery(search: string): ViewQuery {
  const q = new URLSearchParams(search)
  const v = q.get('view')?.toLowerCase()
  const e = q.get('explode')
  const n = e === null || e.trim() === '' ? NaN : Number(e)
  const t = q.get('theme')?.toLowerCase()
  const sd = q.get('side')?.toUpperCase()
  const m = q.get('mirror')
  const str = (k: string) => {
    const s = q.get(k)?.trim()
    return s ? s : null
  }
  return {
    view: v === '2d' || v === '3d' || v === 'sch' || v === 'checks' ? v : null,
    explode: Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : null,
    layer: str('layer'),
    select: str('select'),
    isolate: str('isolate'),
    isolateMode: q.get('isolate-mode') === 'instance' ? 'instance' : q.get('isolate-mode') === 'library' ? 'library' : null,
    focus: str('focus'),
    side: sd === 'F' || sd === 'B' ? sd : null,
    mirror: m === '1' ? true : m === '0' ? false : null,
    theme: t === 'light' || t === 'dark' ? t : null,
  }
}

export const hasViewQuery = (q: ViewQuery): boolean =>
  q.view !== null || q.explode !== null || q.layer !== null || q.select !== null || q.isolate !== null || !!q.focus || q.side !== null || q.mirror !== null || q.theme !== null

/** A search string with `side` and `mirror` set to a view's, the defaults F and off left out. */
export function sideSearch(search: string, side: Side, mirror: boolean): string {
  const q = new URLSearchParams(search)
  if (side === 'B') q.set('side', 'B')
  else q.delete('side')
  if (mirror) q.set('mirror', '1')
  else q.delete('mirror')
  return searchOf(q)
}

/** A search string from its parameters; commas, slashes and colons stay readable in a copied link. */
const searchOf = (q: URLSearchParams): string => {
  const s = q.toString().replace(/%2C/gi, ',').replace(/%2F/gi, '/').replace(/%3A/gi, ':')
  return s ? `?${s}` : ''
}

/** A search string with `select` set to a comma list of references and `isolate` to one, each removed for null. */
export function selectSearch(
  search: string,
  select: string | null,
  isolate: string | null = null,
  focus: string | null = null,
  mode: 'instance' | 'library' | null = null,
): string {
  const q = new URLSearchParams(search)
  if (select) q.set('select', select)
  else q.delete('select')
  if (isolate) q.set('isolate', isolate)
  else q.delete('isolate')
  if (focus) q.set('focus', focus)
  else q.delete('focus')
  if (isolate && mode) q.set('isolate-mode', mode)
  else q.delete('isolate-mode')
  return searchOf(q)
}

/** The view a query opens in: its own, else 3D when it asks for the exploded view, else null for the default. */
export const queryMode = (q: ViewQuery): ViewName | null => q.view ?? (q.explode !== null ? '3d' : null)

/** The id of the layer a name means: an id or a rail name in any case, or an alias of the layer table; null for none. */
export function findLayer(layers: readonly { id: string; name?: string }[], name: string): string | null {
  const k = name.trim().toLowerCase()
  const id = LAYER_ALIASES[k] ?? null
  const hit = layers.find(l => l.id.toLowerCase() === k) ?? (id ? layers.find(l => l.id === id) : undefined) ?? layers.find(l => l.name?.toLowerCase() === k)
  return hit?.id ?? null
}

/** The layers to hide so that `name` shows alone, the board outline kept for context; null when no layer matches. */
export function soloHidden(layers: readonly { id: string; name?: string; kind: string }[], name: string): string[] | null {
  const id = findLayer(layers, name)
  if (!id) return null
  return layers.filter(l => l.id !== id && l.kind !== 'edge').map(l => l.id)
}
