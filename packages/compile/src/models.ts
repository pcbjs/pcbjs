// The mesh itself is converted by the cli, see @pcbjs/step.
import type { Board, DrcMarker } from '@pcbjs/core/model'
import type { ModelSpec, Src, StepModelSpec } from '@pcbjs/core/types'

/** Node's fs, path and url when running in Node, null in a browser. Loaded lazily so the compiler stays importable anywhere. */
export function nodeApi(): { fs: typeof import('node:fs'); path: typeof import('node:path'); url: typeof import('node:url') } | null {
  const p = (globalThis as any).process
  if (!p || typeof p.getBuiltinModule !== 'function') return null
  try {
    return { fs: p.getBuiltinModule('node:fs'), path: p.getBuiltinModule('node:path'), url: p.getBuiltinModule('node:url') }
  } catch {
    return null
  }
}

/** True for a model spec that names a STEP file: kind `step`, or no kind and a `step` string. */
export function isStepSpec(m: unknown): m is StepModelSpec {
  if (!m || typeof m !== 'object') return false
  const k = (m as any).kind
  return k === 'step' || (k === undefined && typeof (m as any).step === 'string')
}

const triple = (v: unknown, name: string, ref: string): [number, number, number] | undefined => {
  if (v === undefined) return undefined
  if (!Array.isArray(v) || v.length !== 3 || !v.every(n => typeof n === 'number' && Number.isFinite(n)))
    throw new Error(`${ref}: model ${name} needs three numbers [x, y, z], got ${JSON.stringify(v)}`)
  return [v[0], v[1], v[2]]
}

/** The absolute path of a file named in a source range: as it is, or found among the files the design imported, or from the working directory. */
export function absFile(file: string, files: ReadonlySet<string> | undefined, path: typeof import('node:path')): string {
  if (path.isAbsolute(file)) return file
  const norm = file.replace(/\\/g, '/')
  for (const f of files ?? []) if (f.replace(/\\/g, '/').endsWith('/' + norm)) return f
  return path.resolve(file)
}

/** A STEP spec checked with its absolute `path`, relative to the innermost call site's file; throws a plain Error, the caller adds the location. */
export function stepSpec(spec: StepModelSpec, ref: string, sites: (Src | undefined)[], files?: ReadonlySet<string>): StepModelSpec {
  if (typeof spec.step !== 'string' || !spec.step.trim()) throw new Error(`${ref}: a STEP model needs step, the file, such as './models/part.step'`)
  if (spec.fallback !== undefined && (!spec.fallback || typeof spec.fallback !== 'object' || typeof spec.fallback.kind !== 'string' || isStepSpec(spec.fallback)))
    throw new Error(`${ref}: model fallback must be a generated model such as { kind: 'box', w, h, height }`)
  const out: StepModelSpec = { kind: 'step', step: spec.step }
  const offset = triple(spec.offset, 'offset', ref),
    rotate = triple(spec.rotate, 'rotate', ref),
    scale = triple(spec.scale, 'scale', ref)
  if (offset) out.offset = offset
  if (rotate) out.rotate = rotate
  if (scale) out.scale = scale
  if (spec.fallback) out.fallback = spec.fallback
  const node = nodeApi()
  if (node) {
    const { path, url } = node
    if (spec.step.startsWith('file:')) out.path = url.fileURLToPath(spec.step)
    else if (path.isAbsolute(spec.step)) out.path = spec.step
    else {
      const base = [...sites].reverse().find(s => s && typeof s.file === 'string' && s.file)
      out.path = base ? path.resolve(path.dirname(absFile(base.file, files, path)), spec.step) : path.resolve(spec.step)
    }
  }
  return out
}

const KICAD_VAR = /^\$\{KICAD\d*_3DMODEL_DIR\}\//

/** The source of a model fetched on first use, `kicad:<path>`, `lcsc:C123` or an https URL; a KiCad library variable path counts as `kicad:`. Null for a local file. */
export function remoteSource(step: string): string | null {
  if (KICAD_VAR.test(step)) return `kicad:${step.replace(KICAD_VAR, '')}`
  return /^(kicad|lcsc):\S/i.test(step) || /^https:\/\//i.test(step) ? step : null
}

/** Finds the local file of a fetched model, fetching it on first use; null when it is not there. The cli sets it on globalThis before each compile. */
export type RemoteModelResolver = (source: string) => string | null
export const REMOTE_MODEL = Symbol.for('pcbjs.remoteModel')

/** A footprint's model as the compiler keeps it: a STEP spec resolved, any other spec as given. A fetched model not yet here is its fallback, marked with `fetch`. */
export function footprintModel(model: ModelSpec, ref: string, sites: (Src | undefined)[], files?: ReadonlySet<string>): ModelSpec {
  if (!isStepSpec(model)) return model
  const source = typeof model.step === 'string' ? remoteSource(model.step) : null
  if (!source) return stepSpec(model, ref, sites, files)
  const resolve = (globalThis as any)[REMOTE_MODEL] as RemoteModelResolver | undefined
  const path = nodeApi() ? (resolve?.(source) ?? null) : null
  if (path) return { ...stepSpec({ ...model, step: path }, ref, sites, files), step: source }
  if (model.fallback?.kind === 'box') return { ...model.fallback, fetch: source }
  return model.fallback ?? stepSpec({ ...model, step: source }, ref, sites, files)
}

/** One `model-missing` warning per footprint whose STEP file is not there. Nothing outside Node, where files cannot be checked. */
export function modelErc(board: Board): DrcMarker[] {
  const node = nodeApi()
  if (!node) return []
  const out: DrcMarker[] = []
  for (const fp of board.footprints) {
    const m = fp.model
    if (!m || m.kind !== 'step' || !m.path) continue
    let ok = false
    try {
      ok = node.fs.statSync(m.path).isFile()
    } catch {
      /* missing */
    }
    if (!ok)
      out.push({
        severity: 'warning',
        rule: 'model-missing',
        message: `${fp.ref}: STEP model ${m.step} not found at ${m.path}; the 3D view draws the generated model`,
        at: [fp.at[0], fp.at[1]],
        ...(fp.src ? { src: fp.src } : {}),
      })
  }
  return out
}
