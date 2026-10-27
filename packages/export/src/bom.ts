import type { Board, Footprint, Pt } from '@pcbjs/core/model'
import { isMpnKey, mpnTag } from '@pcbjs/core/sourcing'
import { bomRows } from '@pcbjs/compile/bom'

// the rows and the sourcing ERC are in @pcbjs/compile, which runs the ERC
export { bomRows, sourcingErc, type BomRow } from '@pcbjs/compile/bom'

const csv = (rows: string[][]) => rows.map(r => r.map(v => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(',')).join('\n') + '\n'
const f = (v: number) => (Math.round(v * 1000) / 1000).toFixed(3)

const FIXED = new Set(['manufacturer', 'datasheet'])

/** The BOM as CSV, MPN resolved for the board's sourcing tags; `MPN:*` keeps the catch-all when a tagged number replaced it. */
export function bomCsv(board: Board): string {
  const rows = bomRows(board)
  const keys = [...new Set(rows.flatMap(r => Object.keys(r.fields)))]
  const other = keys.filter(k => !isMpnKey(k) && !FIXED.has(k.toLowerCase())).sort()
  const tagged = keys.filter(k => !!mpnTag(k)).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
  // the catch-all as given, when a tagged number replaced it in the MPN column of some row
  const catchAll = rows.some(r => !!r.sourcing.tag && Object.keys(r.sourcing.all).some(k => mpnTag(k) === ''))
  const head = ['Refs', 'Value', 'Footprint', 'Qty', 'MPN', 'Source', 'Manufacturer', 'Datasheet', ...other, ...tagged, ...(catchAll ? ['MPN:*'] : [])]
  return csv([head, ...rows.map(r => {
    const s = r.sourcing
    const plain = Object.entries(s.all).find(([k]) => mpnTag(k) === '')?.[1] ?? ''
    return [r.refs.join(' '), r.value, r.footprint, String(r.qty), s.mpn ?? '', s.tag === null ? '' : s.tag || 'MPN', s.manufacturer ?? '', s.datasheet ?? '',
      ...other.map(k => r.fields[k] ?? ''), ...tagged.map(k => r.fields[k] ?? ''), ...(catchAll ? [plain] : [])]
  })])
}


// the courtyard centre is taken in the footprint's own frame so a rotated part keeps its body centre
export function cplPoint(board: Board, fp: Footprint, origin: 'footprint' | 'center' = board.cpl?.origin ?? 'footprint'): Pt {
  if (origin === 'footprint') return fp.at
  const a = (fp.rot * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a)
  // board to footprint frame and back: rotate by the footprint's angle, mirrored in x on the back
  const local = (p: Pt): Pt => { const dx = p[0] - fp.at[0], dy = p[1] - fp.at[1], x = dx * c - dy * s, y = dx * s + dy * c; return [fp.side === 'B' ? -x : x, y] }
  const layer = `${fp.side}.CrtYd`
  const mine = board.items.filter(it => it.ref === fp.ref)
  let pts = mine.flatMap(it => (it.kind === 'graphic' && it.layer === layer ? it.paths.flat() : []))
  if (!pts.length) pts = fp.pads.flatMap(id => { const it = board.items[id - 1]; return it?.kind === 'pad' ? it.poly : [] })
  if (!pts.length) return fp.at
  const l = pts.map(local)
  const cx = (Math.min(...l.map(p => p[0])) + Math.max(...l.map(p => p[0]))) / 2, cy = (Math.min(...l.map(p => p[1])) + Math.max(...l.map(p => p[1]))) / 2
  const x = fp.side === 'B' ? -cx : cx
  return [fp.at[0] + x * c + cy * s, fp.at[1] - x * s + cy * c]
}

/** Placement file in the JLCPCB column layout, Y up like KiCad's position files. */
export function cplCsv(board: Board): string {
  const rows = board.footprints.filter(fp => fp.pos && !fp.dnp).map(fp => {
    const [x, y] = cplPoint(board, fp)
    return [fp.ref, fp.value, fp.id.split(':').pop() ?? fp.id, f(x), f(-y), f(fp.rot), fp.side === 'F' ? 'Top' : 'Bottom']
  })
  return csv([['Designator', 'Val', 'Package', 'Mid X', 'Mid Y', 'Rotation', 'Layer'], ...rows])
}

export function netlistJson(board: Board) {
  const nets: Record<string, { ref: string; pad: string }[]> = {}
  for (const it of board.items) if (it.kind === 'pad' && it.net && it.ref) (nets[it.net] ??= []).push({ ref: it.ref, pad: it.num })
  return nets
}
