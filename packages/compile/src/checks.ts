// The built-in checks of the checks stage, each a unit with the shape of a plugin check: its rule, the facets it reads, and its findings; see docs/design.md.
import type { AutoRouteJob, Board, DrcMarker, Ring } from '@pcbjs/core/model'
import type { FindingInput, StageContext } from '@pcbjs/core/internal/plugin'
import { marker } from './messages.js'
import { area, centroid, difference, polysToRings } from './geom.js'
import { connectivity, type Connectivity } from './connectivity.js'
import {
  clearanceChecks,
  collect,
  copperWeightErc,
  courtyardChecks,
  edgeBandChecks,
  edgeChecks,
  holeChecks,
  lengthChecks,
  maskWebChecks,
  pairChecks,
  silkChecks,
  silkEdgeChecks,
  thermalChecks,
  trackWidthChecks,
  unconnectedChecks,
} from './drc.js'
import { keepoutFindings } from './route-findings.js'
import { currentFindings } from './current.js'
import { referenceDrc } from './drc-reference.js'
import { loopFindings } from './loops.js'
import { sourcingErc } from './bom.js'
import { modelErc } from './models.js'
import type { FacetName } from './facets.js'

/** What a built-in check reads beyond the board: its connectivity, made once per target, and the route jobs. */
export interface CheckCtx extends StageContext {
  conn(): Connectivity
  jobs: readonly AutoRouteJob[]
}

/** One check: its findings are a function of the facets it reads, so it is cached on them alone. */
export interface CheckDef {
  rule: string
  reads: readonly FacetName[]
  /** `erc` for a check whose findings are ERC, timed as such */
  kind?: 'erc'
  run(board: Board, ctx: CheckCtx): FindingInput[]
}

/** What every copper check reads: the copper and the pads, their nets, rules, classes and net ties, the outline and keepouts. */
const COPPER: readonly FacetName[] = ['meta', 'rules', 'stackup', 'outline', 'keepouts', 'parts', 'pads', 'copper', 'nets']
const ROUTED: readonly FacetName[] = [...COPPER, 'routes']
const DRAWN: readonly FacetName[] = [...COPPER, 'drawings']

const erc = (rule: string, reads: readonly FacetName[], run: (b: Board) => DrcMarker[]): CheckDef => ({
  rule,
  reads,
  kind: 'erc',
  run: b => run(b).map(m => ({ ...m, kind: 'erc' })),
})
const drc = (rule: string, reads: readonly FacetName[], run: (b: Board, ctx: CheckCtx) => DrcMarker[]): CheckDef => ({ rule, reads, run })

/** The board's connectivity, its ratsnest and unconnected count: a unit of the checks stage that writes them, made before the checks that read it. */
export const connOf = (board: Board, ctx: StageContext): Connectivity => ctx.memo('connectivity', ctx.target ?? '', () => connectivity(board))

/** The built-in checks in the order they report, ERC first. */
export const CHECKS: readonly CheckDef[] = [
  erc('sourcing', ['meta', 'rules', 'parts'], sourcingErc),
  erc('model', ['parts', 'models'], modelErc),
  erc('copper-weight', ['rules', 'stackup'], copperWeightErc),
  drc('clearance', COPPER, (b, ctx) => clearanceChecks(b, ctx.conn())),
  drc('track-width', COPPER, trackWidthChecks),
  drc('edge-clearance', COPPER, edgeChecks),
  drc('courtyard', ['drawings'], courtyardChecks),
  drc('thermal', COPPER, collect(thermalChecks)),
  drc('hole', COPPER, collect(holeChecks)),
  drc('silk', DRAWN, collect(silkChecks)),
  drc('mask-web', DRAWN, collect(maskWebChecks)),
  drc('pair', ROUTED, collect(pairChecks)),
  drc('length', ROUTED, collect(lengthChecks)),
  drc('silk-edge', DRAWN, collect(silkEdgeChecks)),
  drc('edge-band', DRAWN, collect(edgeBandChecks)),
  drc('unconnected', COPPER, (b, ctx) => unconnectedChecks(b, ctx.conn())),
  drc('reference', [...COPPER, 'rest'], referenceDrc),
  drc('loops', ROUTED, loopFindings),
  drc('keepout', ROUTED, keepoutFindings),
  drc('cutout', ['outline'], b => cutoutFindings(b.outline)),
  drc('current', [...ROUTED, 'jobs'], (b, ctx) => currentFindings(b, ctx.jobs)),
]

/** DRC `cutout-outside`: an Edge.Cuts ring other than the outline that is not wholly inside it, which a fab cannot cut. */
export function cutoutFindings(outline: Ring[]): DrcMarker[] {
  if (outline.length < 2) return []
  const size = (r: Ring) => Math.abs(area([r]))
  const outer = outline.reduce((x, y) => (size(y) > size(x) ? y : x))
  const out: DrcMarker[] = []
  for (const r of outline) {
    if (r === outer) continue
    const past = difference([r], [outer])
    const a = Math.abs(area(polysToRings(past)))
    if (a > 1e-4)
      out.push(
        marker({
          severity: 'error',
          rule: 'cutout-outside',
          args: a > size(r) - 1e-4 ? { outside: true } : {},
          measured: { value: Math.round(a * 100) / 100, unit: 'mm2' },
          at: centroid(past.map(p => p.outer)),
          layer: 'Edge.Cuts',
          witness: { layer: 'Edge.Cuts', rings: polysToRings(past) },
        }),
      )
  }
  return out
}
