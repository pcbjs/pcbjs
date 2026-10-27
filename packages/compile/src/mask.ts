// Shared by the Gerber and SVG writers and the DRC rule mask-web, so what DRC measures is what the mask layer draws.
import type { Board, Graphic, Pad, Ring, Text } from '@pcbjs/core/model'
import { offset, polysToRings } from './geom.js'
import { copperRings } from './copper.js'

/** A pad's mask opening on `side`: its `maskRings`, else the pad grown by its expansion; null when it opens nothing there. */
export function padMask(p: Pad, side: string, rules: Board['rules']): Ring[] | null {
  if (p.maskRings && p.layers.includes(`${side}.Mask`)) return p.maskRings
  if (!p.layers.includes(`${side}.Cu`)) return null
  return polysToRings(offset([p.poly], p.maskExpansion ?? rules.maskExpansion))
}

/** What is drawn on the side's mask layer, a graphic or text that opens the mask, such as a gang opening over a connector. */
export const maskDrawings = (board: Board, side: string): (Graphic | Text)[] =>
  board.items.filter((it): it is Graphic | Text => (it.kind === 'graphic' || it.kind === 'text') && it.layer === `${side}.Mask`)

/** The mask openings of one side, as rings: each pad's opening as the mask layer draws it, and what is drawn on the mask layer. */
export function maskOpenings(board: Board, side: string): Ring[] {
  const out: Ring[] = []
  for (const it of board.items) {
    if (it.kind === 'pad') out.push(...(padMask(it, side, board.rules) ?? []))
    else if ((it.kind === 'graphic' || it.kind === 'text') && it.layer === `${side}.Mask`) out.push(...copperRings(it, it.layer))
  }
  return out
}
