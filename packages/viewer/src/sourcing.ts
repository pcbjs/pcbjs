// free of Vue and the DOM so Node imports it in the tests; old data has neither `sourcing` nor `sourcingTags`
import type { Sourcing } from '@pcbjs/core/site-data'

/** A BOM row as the viewer may receive it: `sourcing` is absent on data built before sourcing existed. */
export interface BomRow { refs: string[]; value: string; footprint: string; qty: number; fields?: Record<string, string>; sourcing?: Sourcing | null }

/** The resolved part number of a row; without sourcing data, the plain MPN field as before. */
export function rowMpn(r: BomRow): string | null {
  if (r.sourcing) return r.sourcing.mpn || null
  return r.fields?.MPN || null
}

/** The label of the tag that matched: the tag itself, "MPN" for the catch-all, null when nothing matched or there is no data. */
export function sourceLabel(s: Sourcing | null | undefined): string | null {
  if (!s || s.tag == null) return null
  return s.tag === '' ? 'MPN' : s.tag
}

/** The sourcing key that matched, "MPN" or "MPN:<tag>", null when nothing matched. */
export function matchedKey(s: Sourcing | null | undefined): string | null {
  if (!s || s.tag == null) return null
  return s.tag === '' ? 'MPN' : `MPN:${s.tag}`
}

export function unsourcedCount(bom: readonly BomRow[] | null | undefined): number {
  return (bom ?? []).filter(r => !rowMpn(r)).length
}

/** "2 rows without a part number", or null when every row has one. */
export function unsourcedText(n: number): string | null {
  return n > 0 ? `${n} ${n === 1 ? 'row' : 'rows'} without a part number` : null
}

/** "Sourcing: LCSC, CN", "Sourcing: MPN only" for an empty list, null when the data has no tags at all. */
export function sourcingLine(tags: readonly string[] | null | undefined): string | null {
  if (!Array.isArray(tags)) return null
  return tags.length ? `Sourcing: ${tags.join(', ')}` : 'Sourcing: MPN only'
}

/** Every sourcing key of a row in the order given, as [key, value] pairs. */
export function sourcingEntries(s: Sourcing | null | undefined): [string, string][] {
  return s?.all ? Object.entries(s.all) : []
}

/** The tooltip of an MPN cell: one "key: value" line per sourcing key. */
export function sourcingTitle(s: Sourcing | null | undefined): string {
  return sourcingEntries(s).map(([k, v]) => `${k}: ${v}`).join('\n')
}

/** The BOM row a ref belongs to. */
export function bomRowOf<R extends BomRow>(bom: readonly R[] | null | undefined, ref: string | null | undefined): R | null {
  if (!ref) return null
  return (bom ?? []).find(r => r.refs.includes(ref)) ?? null
}

const cell = (v: unknown) => String(v ?? '').replace(/[\t\r\n]+/g, ' ')

/** The BOM as tab separated values with a header line: refs, value, footprint, qty, mpn. */
export function bomTsv(bom: readonly BomRow[] | null | undefined): string {
  const lines = [['refs', 'value', 'footprint', 'qty', 'mpn']]
  for (const r of bom ?? []) lines.push([r.refs.join(','), r.value, r.footprint, String(r.qty), rowMpn(r) ?? ''])
  return lines.map(l => l.map(cell).join('\t')).join('\n') + '\n'
}
