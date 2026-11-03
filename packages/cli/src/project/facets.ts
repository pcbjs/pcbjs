// The facets a compile streams as its stages end, see docs/viewer.md; the stream itself is @pcbjs/export's, shared with the browser compile.
import type { StageEvent } from '@pcbjs/compile/internal/pipeline'
import { facetStream as stream, type FacetOut } from '@pcbjs/export/internal/facet-stream'
import type { ResolvedConfig } from './config.js'
import { meshBoundsOf } from './models.js'

export { carry, facetOut, keepLast, siteFacets, stageStatus, type FacetOut, type StageStatus } from '@pcbjs/export/internal/facet-stream'

/** See facetStream of @pcbjs/export/facet-stream, rooted at the project, its model facet with the mesh extents. */
export const facetStream = (cfg: ResolvedConfig, rel: string, dev: boolean, generatedAt: string, out: (f: FacetOut) => void): ((e: StageEvent) => void) =>
  stream(cfg.root, rel, dev, generatedAt, out, meshBoundsOf(cfg.root))
