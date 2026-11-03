// The mesh hash is the name the cli converts and serves the mesh under.
import type { GeneratedSpec, ModelSpec, StepModelSpec } from '@pcbjs/core/internal/types'
import type { Board, Footprint, Pt } from '@pcbjs/core/model'
import type { SiteFootprint, SiteStep } from '@pcbjs/core/site-data'
import { isFileModel, isGenerated } from '@pcbjs/core/internal/model-source'
import { meshKey } from '@pcbjs/step/internal/key'
import { placementIssue, type Box3, type Rect } from '@pcbjs/step/internal/place'
import { platform } from '@pcbjs/core/platform'

// hashes by path, kept while the file's size and mtime stay, on globalThis like the other pcbjs caches
const KEY = Symbol.for('pcbjs.export.meshKeys')
const memo = (): Map<string, { size: number; mtime: number; key: string }> => ((globalThis as any)[KEY] ??= new Map())

// null when the file is missing or unreadable
export function stepMeshKey(path: string): string | null {
  const p = platform()
  const st = p.stat(path)
  if (!st?.file) return null
  const hit = memo().get(path)
  if (hit && hit.size === st.size && hit.mtime === st.mtime) return hit.key
  const bytes = p.read(path)
  if (!bytes) return null
  const key = meshKey(bytes)
  memo().set(path, { size: st.size, mtime: st.mtime, key })
  return key
}

export function siteStep(spec: StepModelSpec, rel: (p: string) => string): SiteStep {
  const mesh = spec.path ? stepMeshKey(spec.path) : null
  return {
    file: spec.path ? rel(spec.path) : spec.file,
    ...(mesh ? { mesh } : {}),
    transform: { offset: spec.offset ?? [0, 0, 0], rotate: spec.rotate ?? [0, 0, 0], scale: spec.scale ?? [1, 1, 1] },
  }
}

// bump when a generated body's geometry in @pcbjs/ui's models changes, so every cached mesh of one is made again
export const MODELS_VERSION = 1

/** What a generated body is drawn for besides its spec: the footprint's height and the board's thickness, mm. */
export interface ModelCtx {
  height: number
  thickness: number
}

/** The mesh hash of a generated body, as a model file's: a printed marking is no geometry, so it is left out. */
export function modelHash(spec: GeneratedSpec, ctx: ModelCtx): string {
  const key = JSON.stringify(['pcbjs-models', MODELS_VERSION, spec, ctx.height, ctx.thickness], (k, v) => (k === 'marking' ? undefined : v))
  return meshKey(new TextEncoder().encode(key))
}

/** The generated body a footprint draws: its model, or a model file's fallback. */
export function generatedOf(model: ModelSpec | undefined): GeneratedSpec | null {
  const spec = isFileModel(model) ? model.fallback : model
  return isGenerated(spec) ? spec : null
}

/** A generated model as it is, a STEP model as its fallback plus `step`. */
export function siteModel(model: ModelSpec | undefined, rel: (p: string) => string): Pick<SiteFootprint, 'model' | 'step'> {
  if (!model) return { model: undefined }
  if (model.kind === undefined) return { model: model.fallback, step: siteStep(model, rel) }
  return { model: model as Exclude<ModelSpec, StepModelSpec> }
}

/** A STEP mesh's extent in its own frame, converting the file when needed; throws with the reason when it does not read. */
export type MeshBounds = (hash: string, path: string) => Box3

/** mm, x right and y down, before the footprint's rotation and its mirror on the back. */
export function toFootprint(fp: Pick<Footprint, 'at' | 'rot' | 'side'>, p: Pt): Pt {
  const a = (fp.rot * Math.PI) / 180,
    dx = p[0] - fp.at[0],
    dy = p[1] - fp.at[1]
  const x = dx * Math.cos(a) - dy * Math.sin(a),
    y = dx * Math.sin(a) + dy * Math.cos(a)
  return [fp.side === 'B' ? -x : x, y]
}

/** In its own frame, else the extent of its pads and graphics; null when it has neither. */
export function courtyardRect(board: Board, fp: Footprint): Rect | null {
  const layer = fp.side === 'B' ? 'B.CrtYd' : 'F.CrtYd'
  const box = (pts: Pt[]): Rect | null => {
    if (!pts.length) return null
    const l = pts.map(p => toFootprint(fp, p))
    return { x0: Math.min(...l.map(p => p[0])), y0: Math.min(...l.map(p => p[1])), x1: Math.max(...l.map(p => p[0])), y1: Math.max(...l.map(p => p[1])) }
  }
  const mine = board.items.filter(it => it.ref === fp.ref)
  return (
    box(mine.flatMap(it => (it.kind === 'graphic' && it.layer === layer ? it.paths.flat() : []))) ??
    box(mine.flatMap(it => (it.kind === 'pad' ? it.poly : it.kind === 'graphic' ? it.paths.flat() : [])))
  )
}

const round3 = (v: number) => Math.round(v * 1000) / 1000

/** A footprint's model as the model facet holds it; a STEP model whose mesh `bounds` reads also has the mesh extent, the courtyard and the issue, if any. */
export function placedModel(board: Board, fp: Footprint, rel: (p: string) => string, bounds?: MeshBounds): Pick<SiteFootprint, 'model' | 'step'> {
  const out = siteModel(fp.model, rel)
  const step = out.step,
    m = fp.model
  if (!step?.mesh || !bounds || !isFileModel(m) || !m.path) return out
  const cy = courtyardRect(board, fp)
  if (cy) step.courtyard = { x0: round3(cy.x0), y0: round3(cy.y0), x1: round3(cy.x1), y1: round3(cy.y1) }
  let b: Box3
  try {
    b = bounds(step.mesh, m.path)
  } catch (e: any) {
    step.issue = `the file did not read: ${String(e?.message ?? e)
      .split('\n')[0]
      .split(` ${m.path}`)
      .join('')}`
    return out
  }
  step.bounds = { min: b.min.map(round3) as Box3['min'], max: b.max.map(round3) as Box3['max'] }
  const tht = fp.pads.some(id => {
    const it = board.items[id - 1]
    return it?.kind === 'pad' && !!it.drill
  })
  const issue = cy ? placementIssue(b, step.transform, cy, 1, { height: fp.height, tht }) : null
  if (issue) step.issue = issue
  return out
}
