// read once at startup and applied after the first render, so a prerendered page hydrates as the server rendered it

/** The largest layer separation of the exploded 3D view in mm, the end of its slider; `explode=1` asks for it. */
export const EXPLODE_MAX = 15

export interface ViewQuery {
  /** the view to open in, null for the default */
  view: '2d' | '3d' | 'sch' | null
  /** the exploded 3D view at this fraction of EXPLODE_MAX, null to leave it as it is */
  explode: number | null
  /** the layer to show alone in 2D, as given */
  layer: string | null
  /** the part to select */
  select: string | null
  /** bottom views the board from below: the 2D view flipped to the back, the 3D camera under the board; null for the top */
  side: 'top' | 'bottom' | null
  theme: 'light' | 'dark' | null
}

/** Read the view query from a location's search string; values that do not parse are dropped. */
export function parseViewQuery(search: string): ViewQuery {
  const q = new URLSearchParams(search)
  const v = q.get('view')?.toLowerCase()
  const e = q.get('explode')
  const n = e === null || e.trim() === '' ? NaN : Number(e)
  const t = q.get('theme')?.toLowerCase()
  const sd = q.get('side')?.toLowerCase()
  const str = (k: string) => {
    const s = q.get(k)?.trim()
    return s ? s : null
  }
  return {
    view: v === '2d' || v === '3d' || v === 'sch' ? v : null,
    explode: Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : null,
    layer: str('layer'),
    select: str('select'),
    side: sd === 'top' || sd === 'bottom' ? sd : null,
    theme: t === 'light' || t === 'dark' ? t : null,
  }
}

export const hasViewQuery = (q: ViewQuery): boolean => q.view !== null || q.explode !== null || q.layer !== null || q.select !== null || q.side !== null || q.theme !== null

/** The view a query opens in: its own, else 3D when it asks for the exploded view, else null for the default. */
export const queryMode = (q: ViewQuery): '2d' | '3d' | 'sch' | null => q.view ?? (q.explode !== null ? '3d' : null)

const ALIASES: Record<string, string> = {
  top: 'F.Cu',
  front: 'F.Cu',
  bottom: 'B.Cu',
  back: 'B.Cu',
  silk: 'F.SilkS',
  'f.silk': 'F.SilkS',
  'f.silkscreen': 'F.SilkS',
  'b.silk': 'B.SilkS',
  'b.silkscreen': 'B.SilkS',
  'f.courtyard': 'F.CrtYd',
  'b.courtyard': 'B.CrtYd',
  edge: 'Edge.Cuts',
  outline: 'Edge.Cuts',
  'edge.cut': 'Edge.Cuts',
}

/** The id of the layer a name means: an id or a rail name in any case, or an alias of the layer table; null for none. */
export function findLayer(layers: readonly { id: string; name?: string }[], name: string): string | null {
  const k = name.trim().toLowerCase()
  const id = ALIASES[k] ?? null
  const hit = layers.find(l => l.id.toLowerCase() === k) ?? (id ? layers.find(l => l.id === id) : undefined) ?? layers.find(l => l.name?.toLowerCase() === k)
  return hit?.id ?? null
}

/** The layers to hide so that `name` shows alone, the board outline kept for context; null when no layer matches. */
export function soloHidden(layers: readonly { id: string; name?: string; kind: string }[], name: string): string[] | null {
  const id = findLayer(layers, name)
  if (!id) return null
  return layers.filter(l => l.id !== id && l.kind !== 'edge').map(l => l.id)
}
