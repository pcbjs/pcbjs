import type { ModelSpec } from './types.js'

/** Where a part's 3D body comes from; `missing` is drawn as a wireframe that says so. */
export type ModelSource = 'file' | 'generated' | 'none' | 'missing'

/** As `model check` and `inspect` print it. */
export const MODEL_LABEL: Record<ModelSource, string> = { file: 'file', generated: 'generated', none: 'no body', missing: 'no model' }

const GENERATED = new Set(['chip', 'led', 'header', 'sot23', 'ic'])

/** `height` as the site data gives it, 0 for a bare hole; a `box` stands in for a model, so it counts as missing. */
export function modelSource(model: ModelSpec | undefined, height: number): ModelSource {
  if (model && (model.kind === undefined || model.kind === 'step')) return 'file'
  if (model?.kind === 'none') return 'none'
  if (model?.kind && GENERATED.has(model.kind)) return 'generated'
  const box = model?.kind === 'box' ? model : null
  return (box ? box.w > 0 && box.h > 0 && box.height > 0 : height > 0) ? 'missing' : 'none'
}

/** How many parts of each source. */
export function countModels(parts: { model?: ModelSpec; step?: unknown; height: number }[]): Record<ModelSource, number> {
  const n = { file: 0, generated: 0, none: 0, missing: 0 }
  for (const p of parts) n[p.step ? 'file' : modelSource(p.model, p.height)]++
  return n
}
