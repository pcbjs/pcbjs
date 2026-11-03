// When the 3D view remakes its scene; free of three.js so Node tests count it.
import type { SiteData } from '@pcbjs/core/site-data'
import { FACET_NAMES, FACETS, type FacetName } from '@pcbjs/core/site-facets'

/** The facets whose data differs between two boards, by identity of their keys; every one for a first board. */
export function changedFacets(was: SiteData | undefined, now: SiteData): Set<FacetName> {
  if (!was) return new Set(FACET_NAMES)
  const a = was as unknown as Record<string, unknown>,
    b = now as unknown as Record<string, unknown>
  return new Set(FACET_NAMES.filter(f => Object.keys(FACETS[f].keys).some(k => a[k] !== b[k])))
}

/** Whether new board data remakes the 3D scene: new shapes or a new outline remake the board, new footprints the bodies; the findings, the schematic and the fab set never do. */
export const remakes = (was: SiteData | undefined, now: SiteData): boolean => !was || was.shapes !== now.shapes || was.footprints !== now.footprints || was.outline !== now.outline
