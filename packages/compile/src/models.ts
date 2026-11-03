// The mesh itself is converted by the cli, see @pcbjs/step.
import { marker } from './messages.js'
import type { Board, DrcMarker } from '@pcbjs/core/model'
import type { ModelSpec, Src, StepModelSpec } from '@pcbjs/core/internal/types'
import { isFileModel } from '@pcbjs/core/internal/model-source'
import { realm } from '@pcbjs/core/internal/realm'
import { platform, type PathApi } from '@pcbjs/core/platform'

/** True for a model spec that names a file, `{ file }` with no kind. */
export const isStepSpec = isFileModel

/** Throws for the removed model keys `step` and `kind: 'step'`. */
export function checkModelKeys(m: unknown, ref: string): void {
  if (!m || typeof m !== 'object') return
  if ((m as any).kind === 'step') throw new Error(`${ref}: a model file has no kind, write { file: './models/part.step' }`)
  if ('step' in m) throw new Error(`${ref}: the model file key is file, such as { file: './models/part.step' }`)
}

const triple = (v: unknown, name: string, ref: string): [number, number, number] | undefined => {
  if (v === undefined) return undefined
  if (!Array.isArray(v) || v.length !== 3 || !v.every(n => typeof n === 'number' && Number.isFinite(n)))
    throw new Error(`${ref}: model ${name} needs three numbers [x, y, z], got ${JSON.stringify(v)}`)
  return [v[0], v[1], v[2]]
}

/** The absolute path of a file named in a source range: as it is, or found among the files the design imported, relative to the loader source root, or from the working directory without a root. */
export function absFile(file: string, files: ReadonlySet<string> | undefined, path: PathApi, sourceRoot?: string): string {
  if (path.isAbsolute(file)) return file
  if (sourceRoot) return path.resolve(sourceRoot, file)
  const norm = file.replace(/\\/g, '/')
  for (const f of files ?? []) if (f.replace(/\\/g, '/').endsWith('/' + norm)) return f
  return path.resolve(file)
}

/** A STEP spec checked with its absolute `path`, relative to the innermost call site's file; throws a plain Error, the caller adds the location. */
export function stepSpec(spec: StepModelSpec, ref: string, sites: (Src | undefined)[], files?: ReadonlySet<string>, sourceRoot?: string): StepModelSpec {
  if (typeof spec.file !== 'string' || !spec.file.trim()) throw new Error(`${ref}: a model file needs file, such as './models/part.step'`)
  if (spec.fallback !== undefined && (!spec.fallback || typeof spec.fallback !== 'object' || typeof spec.fallback.kind !== 'string' || isStepSpec(spec.fallback)))
    throw new Error(`${ref}: model fallback must be a generated model such as { kind: 'box', w, h, height }`)
  const out: StepModelSpec = { file: spec.file }
  const offset = triple(spec.offset, 'offset', ref),
    rotate = triple(spec.rotate, 'rotate', ref),
    scale = triple(spec.scale, 'scale', ref)
  if (offset) out.offset = offset
  if (rotate) out.rotate = rotate
  if (scale) out.scale = scale
  if (spec.fallback) out.fallback = spec.fallback
  const p = platform()
  const path = p.path
  if (typeof spec.path === 'string' && path.isAbsolute(spec.path)) out.path = spec.path
  else if (spec.file.startsWith('file:')) out.path = p.fromUrl(spec.file)
  else if (path.isAbsolute(spec.file)) out.path = spec.file
  else {
    const base = [...sites].reverse().find(s => s && typeof s.file === 'string' && s.file)
    out.path = base ? path.resolve(path.dirname(absFile(base.file, files, path, sourceRoot)), spec.file) : path.resolve(spec.file)
  }
  return out
}

/** The source of a model fetched on first use, `kicad:<path>`, `lcsc:C123` or an https URL; null for a local file. */
export function remoteSource(file: string): string | null {
  return /^(kicad|lcsc):\S/i.test(file) || /^https:\/\//i.test(file) ? file : null
}

/** The tag of KiCad's 3D library the stdlib's models are aligned against. */
export const KICAD_3D_TAG = '10.0.7'

/** The path of a fetched model under a project's .pcbjs/models/fetched, `/` separated: where the cli keeps it and the browser compile finds it. */
export function fetchedRel(source: string): string {
  if (/^kicad:/i.test(source)) return `kicad-${KICAD_3D_TAG}/${source.slice('kicad:'.length).replace(/\.wrl$/i, '.step')}`
  if (/^lcsc:/i.test(source)) return `lcsc/${source.slice(5).toUpperCase()}.step`
  const u = new URL(source)
  return [u.host, ...u.pathname.split('/').filter(Boolean).map(decodeURIComponent)].join('/')
}

/** A footprint's model as the compiler keeps it: a STEP spec resolved, any other spec as given. A fetched model not yet here is its fallback, marked with `fetch`. */
export function footprintModel(model: ModelSpec, ref: string, sites: (Src | undefined)[], files?: ReadonlySet<string>, sourceRoot?: string): ModelSpec {
  checkModelKeys(model, ref)
  if (!isStepSpec(model)) return model
  if (/^\$\{KICAD\d*_3DMODEL_DIR\}/.test(model.file)) throw new Error(`${ref}: a KiCad library model is kicad:<Lib>.3dshapes/<Name>.step, not ${model.file}`)
  const source = remoteSource(model.file)
  if (!source) return stepSpec(model, ref, sites, files, sourceRoot)
  const resolve = realm().remoteModel
  const path = resolve?.(source) ?? null
  if (path) return { ...stepSpec({ ...model, file: path, path }, ref, sites, files, sourceRoot), file: source }
  if (model.fallback?.kind === 'box') return { ...model.fallback, fetch: source }
  return model.fallback ?? stepSpec({ ...model, file: source, path: undefined }, ref, sites, files, sourceRoot)
}

/** The files whose presence and content decide the board's models: each STEP file, and where a fetched model still waiting would land. */
export function modelFiles(board: Board): string[] {
  const watch = realm().remoteModel?.watch
  const out = new Set<string>()
  for (const fp of board.footprints) {
    const m = fp.model
    if (isFileModel(m) && m.path) out.add(m.path)
    const waiting = m?.kind === 'box' ? m.fetch : isFileModel(m) && remoteSource(m.file) && !platform().stat(m.path ?? '')?.file ? m.file : undefined
    if (waiting && watch) for (const f of watch(waiting)) out.add(f)
  }
  return [...out].sort()
}

/** One `model-missing` warning per footprint whose STEP file is not there. */
export function modelErc(board: Board): DrcMarker[] {
  const p = platform()
  const out: DrcMarker[] = []
  for (const fp of board.footprints) {
    const m = fp.model
    if (!isFileModel(m) || !m.path) continue
    if (!p.stat(m.path)?.file)
      out.push(
        marker({
          severity: 'warning',
          rule: 'model-missing',
          args: { ref: fp.ref, file: m.file, path: m.path },
          refs: [fp.ref],
          at: [fp.at[0], fp.at[1]],
          ...(fp.src ? { src: fp.src } : {}),
        }),
      )
  }
  return out
}
