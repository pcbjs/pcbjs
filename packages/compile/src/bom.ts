import type { Board, DrcMarker } from '@pcbjs/core/model'
import type { Sourcing } from '@pcbjs/core/site-data'
import { resolveSourcing } from '@pcbjs/core/sourcing'

export interface BomRow {
  refs: string[]
  value: string
  footprint: string
  qty: number
  fields: Record<string, string>
  /** the part number this board or target orders, from its sourcing tags */
  sourcing: Sourcing
}

export function bomRows(board: Board): BomRow[] {
  const groups = new Map<string, BomRow>()
  for (const fp of board.footprints) {
    if (!fp.bom) continue
    const key = `${fp.value}\0${fp.id}\0${JSON.stringify(fp.fields)}`
    const g = groups.get(key) ?? { refs: [], value: fp.value, footprint: fp.id, qty: 0, fields: fp.fields, sourcing: resolveSourcing(fp.fields, board.sourcingTags ?? []) }
    g.refs.push(fp.ref)
    g.qty++
    groups.set(key, g)
  }
  const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true })
  const rows = [...groups.values()]
  for (const r of rows) r.refs.sort(natural)
  return rows.sort((a, b) => natural(a.refs[0], b.refs[0]))
}

/** ERC warnings `unsourced-part`, a row without MPN under `requireSourcing`, and `unsourced-target`, a row whose tagged MPNs match none of the board's tags. */
export function sourcingErc(board: Board): DrcMarker[] {
  const out: DrcMarker[] = []
  const tags = board.sourcingTags ?? []
  for (const r of bomRows(board)) {
    const fp = board.footprints.find(f => f.ref === r.refs[0])
    const at: [number, number] = fp ? [fp.at[0], fp.at[1]] : [0, 0]
    const what = `${r.refs.join(' ')}, ${r.value || r.footprint},`
    const keys = Object.keys(r.sourcing.all)
    if (!keys.length) {
      if (board.rules.requireSourcing) out.push({ severity: 'warning', rule: 'unsourced-part', message: `${what} has no MPN: give it MPN or MPN:<tag> with source()`, at })
    } else if (tags.length && r.sourcing.mpn === null)
      out.push({ severity: 'warning', rule: 'unsourced-target', message: `${what} has ${keys.join(', ')} but none for the tags ${tags.join(', ')} and no catch-all MPN`, at })
  }
  return out
}
