import type { Board, Pad, Ring } from '@pcbjs/core/model'
import { offset, polysToRings } from '@pcbjs/compile/geom'

// the mask opening lives in @pcbjs/compile, which the DRC rule mask-web measures with
export { padMask } from '@pcbjs/compile/mask'

/** The paste of a pad on `side`: its `pasteRings`, else an SMD pad less its paste shrink; null when it prints none there. */
export function padPaste(p: Pad, side: string, rules: Board['rules']): Ring[] | null {
  if (!p.layers.includes(`${side}.Cu`)) return null
  if (p.pasteRings) return p.pasteRings.length ? p.pasteRings : null
  if (!p.paste || p.type !== 'smd') return null
  const shrink = p.pasteShrink ?? rules.pasteShrink
  return shrink > 0 ? polysToRings(offset([p.poly], -shrink)) : [p.poly]
}
