// Where a reference of the selection is placed or defined, for the editor jumps of a click, an alt-click and the chip's buttons.
import type { SiteData, SourceRange } from '@pcbjs/core/site-data'
import { siteTarget } from './refs'
import { definitionOf, smallest, sourceTarget, type Located, type SourceKind, type SourceTarget } from './source'

type Pos = [number, number]
type SrcAt = { file: string; line: number; col: number; endLine?: number; endCol?: number }
const targetOf = (s: SrcAt | undefined): SourceTarget | null =>
  s ? { file: s.file, start: [s.line, s.col], ...(s.endLine != null && s.endCol != null ? { end: [s.endLine, s.endCol] as Pos } : {}) } : null
const placedAt = (s: SourceTarget | null): SourceTarget | null => (s ? { ...s, at: true } : null)
const sameStart = (a: SourceTarget | null, file: string, r: SourceRange) => !!a && a.file === file && a.start[0] === r.start[0] && a.start[1] === r.start[1]

/** Where a reference is placed or defined: a part's or a pad's placement, the schematic's `<Schematic>` in the schematic view else the PCB's, and a part's definition, its declaration else its footprint factory; a route's call and its helper; an item's range; an instance's placement and the render of its layout, the smallest range holding all its parts away from where it is placed. */
export function refSource(b: SiteData, ref: string, kind: SourceKind, sch = false): SourceTarget | null {
  let t
  try {
    t = siteTarget(b, ref)
  } catch {
    return null
  }
  if ((t.kind === 'part' || t.kind === 'pad') && kind === 'placement' && sch) {
    const r = t.ref
    return placedAt(targetOf(b.schematic.drawing?.symbols.find(s => s.ref === r && !s.auto)?.src)) ?? targetOf(b.schematic.parts.find(p => p.ref === r)?.src)
  }
  if (t.kind === 'part' && kind === 'placement') return placedAt(sourceTarget(b, { ref: t.ref }, kind))
  // a part's declaration, `const J1 = PinHeader(4)()` or a circuit's `R: R0603('330')`, else its footprint factory
  if (t.kind === 'part') {
    const r = t.ref
    return targetOf(b.schematic.parts.find(p => p.ref === r)?.src) ?? definitionOf(b, r) ?? sourceTarget(b, { ref: r }, kind)
  }
  if (t.kind === 'pad') return sourceTarget(b, { ref: t.ref, id: t.id }, kind)
  if (t.kind === 'route' || t.kind === 'pt') {
    const id = t.kind === 'route' ? t.id : t.route
    const r = b.routes?.find(x => x.id === id)
    return kind === 'placement' ? targetOf(r?.call ?? r?.src) : targetOf(r?.src)
  }
  if (t.kind === 'item') return sourceTarget(b, { id: t.id }, kind)
  if (t.kind === 'group') {
    const parts = t.refs.filter(r => b.footprints.some(f => f.ref === r))
    if (!parts.length) return null
    const place = sourceTarget(b, { ref: parts[0] }, 'placement')
    if (kind === 'placement') return place
    const holding: Located[] = []
    for (const [file, ranges] of Object.entries(b.sources ?? {}))
      for (const range of ranges) if (!sameStart(place, file, range) && parts.every(p => range.refs.includes(p))) holding.push({ file, range })
    const def = smallest(holding.filter(h => h.file !== place?.file).length ? holding.filter(h => h.file !== place?.file) : holding)
    return def ? { file: def.file, start: def.range.start, end: def.range.end } : null
  }
  return null
}
