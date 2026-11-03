import type { GeneratedKind, GeneratedModels, GeneratedSpec, ModelSpec, StepModelSpec } from './types.js'

/** True for a model file spec, `{ file }`, which has no `kind`. */
export const isFileModel = (m: unknown): m is StepModelSpec => !!m && typeof m === 'object' && (m as any).kind === undefined && typeof (m as any).file === 'string'

/** Where a part's 3D body comes from; `missing` is drawn as a wireframe that says so. */
export type ModelSource = 'file' | 'generated' | 'none' | 'missing'

/** As `model check` and `inspect` print it. */
export const MODEL_LABEL: Record<ModelSource, string> = { file: 'file', generated: 'generated', none: 'no body', missing: 'no model' }

/** The kinds of generated body, one per key of GeneratedModels. */
export const GENERATED_KINDS = ['chip', 'led', 'header', 'sot23', 'ic'] as const satisfies readonly (keyof GeneratedModels)[]
const GENERATED: ReadonlySet<string> = new Set<GeneratedKind>(GENERATED_KINDS)

/** True for a body the 3D view, the GLB and references generate from its dimensions. */
export const isGenerated = (m: ModelSpec | undefined): m is GeneratedSpec => !!m?.kind && GENERATED.has(m.kind)

/** `height` as the site data gives it, 0 for a bare hole; a `box` stands in for a model, so it counts as missing. */
export function modelSource(model: ModelSpec | undefined, height: number): ModelSource {
  if (model && model.kind === undefined) return 'file'
  if (model?.kind === 'none') return 'none'
  if (isGenerated(model)) return 'generated'
  const box = model?.kind === 'box' ? model : null
  return (box ? box.w > 0 && box.h > 0 && box.height > 0 : height > 0) ? 'missing' : 'none'
}

/** How many parts of each source. */
export function countModels(parts: { model?: ModelSpec; step?: unknown; height: number }[]): Record<ModelSource, number> {
  const n = { file: 0, generated: 0, none: 0, missing: 0 }
  for (const p of parts) n[p.step ? 'file' : modelSource(p.model, p.height)]++
  return n
}
