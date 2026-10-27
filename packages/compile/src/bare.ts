// One predicate so the 3D view and the silk refs agree on which footprints get no body and no ref.
import type { Board, Footprint, Pad } from '@pcbjs/core/model'

/** Footprint ids that name a mounting hole, a test point or pad, a pogo pad or a fiducial. */
const NAMED = /mounting.?hole|test.?point|test.?pad|pogo|fiducial/i

/** True for a footprint that is only a hole or a contact: a drilled pad without copper, a test point, pogo pad or fiducial, or a mounting hole. */
export function bareHole(board: Board, fp: Footprint): boolean {
  const pads = fp.pads.map(id => board.items[id - 1]).filter((it): it is Pad => it?.kind === 'pad')
  if (!pads.length) return false
  const named = NAMED.test(fp.id ?? '')
  const unlisted = fp.bom === false && fp.pos === false
  if (pads.length === 1 && (unlisted || named)) return true
  if (pads.some(p => !p.drill)) return false
  if (pads.length === 1 && !pads.some(p => p.layers.some(l => l.endsWith('.Cu')))) return true
  return unlisted || named
}
