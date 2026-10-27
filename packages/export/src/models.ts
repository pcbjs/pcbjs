// The mesh hash is the name the cli converts and serves the mesh under.
import type { ModelSpec, StepModelSpec } from '@pcbjs/core/types'
import type { SiteFootprint, SiteStep } from '@pcbjs/core/site-data'
import { meshKey } from '@pcbjs/step/key'

// hashes by path, kept while the file's size and mtime stay, on globalThis like the other pcbjs caches
const KEY = Symbol.for('pcbjs.export.meshKeys')
const memo = (): Map<string, { size: number; mtime: number; key: string }> => ((globalThis as any)[KEY] ??= new Map())

function nodeFs(): typeof import('node:fs') | null {
  const p = (globalThis as any).process
  try { return p?.getBuiltinModule?.('node:fs') ?? null } catch { return null }
}

// null when the file is missing or unreadable
export function stepMeshKey(path: string): string | null {
  const fs = nodeFs()
  if (!fs) return null
  try {
    const st = fs.statSync(path)
    if (!st.isFile()) return null
    const hit = memo().get(path)
    if (hit && hit.size === st.size && hit.mtime === st.mtimeMs) return hit.key
    const key = meshKey(new Uint8Array(fs.readFileSync(path)))
    memo().set(path, { size: st.size, mtime: st.mtimeMs, key })
    return key
  } catch { return null }
}

export function siteStep(spec: StepModelSpec, rel: (p: string) => string): SiteStep {
  const mesh = spec.path ? stepMeshKey(spec.path) : null
  return {
    file: spec.path ? rel(spec.path) : spec.step ?? spec.file ?? '',
    ...(mesh ? { mesh } : {}),
    transform: { offset: spec.offset ?? [0, 0, 0], rotate: spec.rotate ?? [0, 0, 0], scale: spec.scale ?? [1, 1, 1] },
  }
}

/** A generated model as it is, a STEP model as its fallback plus `step`. */
export function siteModel(model: ModelSpec | undefined, rel: (p: string) => string): Pick<SiteFootprint, 'model' | 'step'> {
  if (!model) return { model: undefined }
  if (model.kind === 'step' || (model.kind === undefined && ('step' in model || 'file' in model))) {
    const spec = model as StepModelSpec
    return { model: spec.fallback, step: siteStep(spec, rel) }
  }
  return { model: model as Exclude<ModelSpec, StepModelSpec> }
}
