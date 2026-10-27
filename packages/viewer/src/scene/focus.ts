// which parts of the 3D board turn see-through, and how far a hover reaches while a focus is on
import type { HlState } from './highlight'

export interface Selection { net?: string | null; ref?: string | null; refs?: readonly string[]
  /** the pinned net with the rest of its pair group, as netRoles gives them; the net alone when absent */
  nets?: Iterable<string> }

/** Groups that are no layer of the stack and never dim for a hovered one. */
const OVER = new Set(['overlay', 'References'])

/** A pinned net, or a selected part, pad or group, with the focus fade on: the board turns see-through. Hover never does. */
export function translucent(s: Selection, fade: boolean): boolean {
  return fade && !!(s.net || s.ref || s.refs?.length)
}

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

/** What a hover is held to under the focus fade: the pinned net with its pair group, the selected parts, and for part bodies also the parts on those nets. */
export interface Scope { nets: ReadonlySet<string>; refs: ReadonlySet<string>; parts: ReadonlySet<string> }
/** A hovered item: copper names its net and part; `body` is a part body or symbol; `refs` the parts of a sheet. */
export interface Hovered { net?: string | null; ref?: string | null; refs?: readonly string[]; body?: boolean }
interface ScopeBoard { footprints: readonly { ref: string; pads: readonly { net?: string | null }[] }[] }

/** The scope of a focus, null without one: the fade off, or nothing pinned or selected. */
export function hoverScope(s: Selection, fade: boolean, board: ScopeBoard | null): Scope | null {
  if (!translucent(s, fade) || !board) return null
  const nets = new Set(s.nets ?? (s.net ? [s.net] : []))
  const refs = new Set([...(s.ref ? [s.ref] : []), ...(s.refs ?? [])])
  const parts = new Set(refs)
  for (const fp of board.footprints) if (fp.pads.some(p => p.net && nets.has(p.net))) parts.add(fp.ref)
  return { nets, refs, parts }
}

/** True when a hover may act as before: no focus, or an item of it, a selected part's pads and pins included. */
export function inScope(h: Hovered, s: Scope | null): boolean {
  if (!s) return true
  if (h.net && s.nets.has(h.net)) return true
  const parts = h.body ? s.parts : s.refs
  return [h.ref, ...(h.refs ?? [])].some(r => !!r && parts.has(r))
}

/** The tint of a hover outside the focus: next to nothing, so it reads as its outline alone. */
export const GHOST_FILL = 0.02

/** The fill strength of a hover: full in scope, else GHOST_FILL, which leaves a bare outline. */
export function hoverFill(h: Hovered, s: Scope | null): number {
  return inScope(h, s) ? 1 : GHOST_FILL
}
