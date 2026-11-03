// which parts of the 3D board turn see-through: a hovered layer of the exploded stack, and the slabs under a focus
import type { HlState } from './highlight'

/** Groups that are no layer of the stack and never dim for a hovered one. */
const OVER = new Set(['overlay', 'References'])

/** While a layer of the exploded stack is hovered, every other group goes semi-transparent. */
export function layerDimmed(group: string | undefined, hovered: string | null): boolean {
  return !!hovered && group !== hovered && !OVER.has(group ?? '')
}

/** A dielectric or mask slab: see-through for a hovered other layer, faded with the rest out of focus for a selection or while inner copper shows through it, else dimmed by any focus. */
export function slabState(o: { inner: boolean; translucent: boolean; dimmed: boolean; focus: boolean }): HlState | null {
  if (o.dimmed) return 'see'
  if (o.inner || o.translucent) return 'fade'
  return o.focus ? 'dim' : null
}
