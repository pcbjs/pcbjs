// free of Vue and the DOM so Node imports it in the tests; old data has neither `schematic` nor `erc`
import type { Schematic, SchematicNet, SchematicPart, SiteData } from '@pcbjs/core/site-data'
import type { DrcMarker } from '@pcbjs/core/model'

/** A pin reference as the schematic writes it, "R1.2": the ref before the first dot, the pin after it; null when there is no dot. */
export function parsePin(s: string): { ref: string; pin: string } | null {
  const i = s.indexOf('.')
  return i > 0 && i < s.length - 1 ? { ref: s.slice(0, i), pin: s.slice(i + 1) } : null
}

/** One row of the Nets tab. */
export interface NetRow {
  name: string
  class?: string
  local: boolean
  /** the owning instance of a local net, absent for a board-level net and on old data */ path?: string[]
}
/** The nets in schematic declaration order, then the board's others; the board's alphabetical list without schematic nets. */
export function orderNets(boardNets: readonly string[] | undefined, schematic: Partial<Schematic> | null | undefined): NetRow[] {
  const sn = schematic?.nets ?? []
  const out: NetRow[] = []
  const seen = new Set<string>()
  for (const n of sn) {
    if (!n || seen.has(n.name)) continue
    seen.add(n.name)
    out.push({ name: n.name, ...(n.class ? { class: n.class } : {}), local: !!n.local, ...(Array.isArray(n.path) && n.path.length ? { path: [...n.path] } : {}) })
  }
  for (const name of boardNets ?? [])
    if (!seen.has(name)) {
      seen.add(name)
      out.push({ name, local: false })
    }
  return out
}

/** The schematic part with this ref, null when the schematic lacks it or is missing. */
export const schematicPart = (schematic: Partial<Schematic> | null | undefined, ref: string | null | undefined): SchematicPart | null =>
  (ref != null ? schematic?.parts?.find(p => p.ref === ref) : undefined) ?? null

/** Natural ref order: prefix, then number, so R2 comes before R10. */
export function compareRefs(a: string, b: string): number {
  const ra = /^(.*?)(\d+)$/.exec(a),
    rb = /^(.*?)(\d+)$/.exec(b)
  if (ra && rb && ra[1] === rb[1]) return +ra[2] - +rb[2]
  return a < b ? -1 : a > b ? 1 : 0
}

/** The text of a pin chip: "1 GND", "3 NC" for a pin marked not connected, the bare name for a pin on no net. */
export const pinLabel = (p: { name: string; net: string | null; nc: boolean }): string => (p.nc ? `${p.name} NC` : p.net != null ? `${p.name} ${p.net}` : p.name)

/** The parts in ref order and the nets in declaration order that match a filter: ref, value, footprint or a pin's net for a part, name, class or a pin for a net. */
export function filterSchematic(schematic: Partial<Schematic> | null | undefined, query: string): { parts: SchematicPart[]; nets: SchematicNet[] } {
  const q = query.trim().toLowerCase()
  const has = (s: string | null | undefined) => !!s && s.toLowerCase().includes(q)
  const parts = [...(schematic?.parts ?? [])].sort((a, b) => compareRefs(a.ref, b.ref))
  const nets = [...(schematic?.nets ?? [])]
  if (!q) return { parts, nets }
  return {
    parts: parts.filter(p => has(p.ref) || has(p.value) || has(p.footprint) || p.pins.some(x => has(x.net))),
    nets: nets.filter(n => has(n.name) || has(n.class) || n.pins.some(has)),
  }
}

/** The part an ERC finding names: the first word that is a known ref, else the ref of a pin reference such as "R1.2". */
export function refFromMessage(message: string, refs: Iterable<string>): string | null {
  const known = new Set(refs)
  for (const m of message.matchAll(/[A-Za-z_][\w-]*(?:\.[\w-]+)?/g)) {
    const w = m[0]
    if (known.has(w)) return w
    const p = parsePin(w)
    if (p && known.has(p.ref)) return p.ref
  }
  return null
}

/** Where a click on an ERC row goes: the point when it has one, else the part it names, else nowhere. */
export type ErcTarget = { kind: 'at'; at: [number, number] } | { kind: 'ref'; ref: string } | null
export function ercTarget(d: Pick<DrcMarker, 'at' | 'message'>, refs: Iterable<string>, itemRefs?: Iterable<string>): ErcTarget {
  if (d.at && (d.at[0] !== 0 || d.at[1] !== 0)) return { kind: 'at', at: [d.at[0], d.at[1]] }
  const r = refFromMessage(d.message ?? '', refs)
  if (r) return { kind: 'ref', ref: r }
  for (const x of itemRefs ?? []) return { kind: 'ref', ref: x }
  return null
}

/** The refs of an entry that the schematic or the board knows. */
export function knownRefs(b: Pick<SiteData, 'footprints'> & { schematic?: Partial<Schematic> | null }): string[] {
  const s = new Set<string>()
  for (const p of b.schematic?.parts ?? []) s.add(p.ref)
  for (const f of b.footprints ?? []) s.add(f.ref)
  return [...s]
}
