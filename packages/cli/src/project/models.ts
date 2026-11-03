// meshes cached as .pcbjs/models/<hash>.bin, each a view of the user cache, the hash from @pcbjs/step/key as the site data's `step.mesh`; OpenCascade loads here only
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Board } from '@pcbjs/core/model'
import type { SiteData } from '@pcbjs/core/site-data'
import type { GeneratedSpec } from '@pcbjs/core/internal/types'
import { isFileModel } from '@pcbjs/core/internal/model-source'
import { meshKey } from '@pcbjs/step/internal/key'
import { meshFromBinary, meshToBinary } from '@pcbjs/step/binary'
import { bounds, type StepModel } from '@pcbjs/step/internal/mesh'
import { modelMatrix, transformBox, type Box3 } from '@pcbjs/step/internal/place'
import { generatedOf, stepMeshKey, type MeshBounds, type ModelCtx } from '@pcbjs/export/internal/models'
import type { GlbInputs } from '@pcbjs/export/internal/board-glb'
import type { ModelBoxLoader } from '@pcbjs/compile/internal/reference'
import type { Compiled } from './project.js'
import { referenceMesh } from './references.js'
import { fetchNotice, installModelFetch } from './fetch-model.js'
import { readMesh, writeMesh } from './mesh-cache.js'

const HASH = /^[0-9a-f]{64}$/

/** A mesh hash as the site data's `step.mesh` names it. */
export const isMeshHash = (s: string): boolean => HASH.test(s)

export const modelsDir = (root: string): string => join(root, '.pcbjs', 'models')

/** By mesh hash: the absolute path the compiler resolved. */
export function usedModels(compiled: Iterable<Pick<Compiled, 'board' | 'site'>>): Map<string, string> {
  const out = new Map<string, string>()
  for (const c of compiled) {
    const byRef = new Map(c.board.footprints.map(f => [f.ref, f]))
    for (const fp of c.site.footprints) {
      const mesh = fp.step?.mesh,
        m = byRef.get(fp.ref)?.model
      if (mesh && isFileModel(m) && m.path) out.set(mesh, m.path)
    }
  }
  return out
}

// by hash, so concurrent requests share one conversion
const INFLIGHT = Symbol.for('pcbjs.cli.models.inflight')
const inflight = (): Map<string, Promise<Uint8Array>> => ((globalThis as any)[INFLIGHT] ??= new Map())

/** From the project, the user cache, or one conversion written to both; throws when the content no longer has this hash. */
export function meshFor(hash: string, path: string, dir: string): Promise<Uint8Array> {
  if (!HASH.test(hash)) return Promise.reject(new Error(`not a mesh hash: ${hash}`))
  const hit = readMesh(hash, dir)
  if (hit) return Promise.resolve(hit)
  const running = inflight().get(hash)
  if (running) return running
  const job = (async () => {
    const content = new Uint8Array(readFileSync(path))
    if (meshKey(content) !== hash) throw new Error(`${path} changed since the board compiled`)
    const { modelToMesh, meshToBinary } = await import('@pcbjs/step')
    const bin = meshToBinary(await modelToMesh(content, { path }))
    writeMesh(hash, path, dir, bin)
    return bin
  })()
  inflight().set(hash, job)
  job.then(
    () => inflight().delete(hash),
    () => inflight().delete(hash),
  )
  return job
}

// by hash, for the life of the process
const BOUNDS = Symbol.for('pcbjs.cli.models.bounds')
const boundsMemo = (): Map<string, Box3> => ((globalThis as any)[BOUNDS] ??= new Map())

const MODEL_CHILD = fileURLToPath(new URL('../model-child.js', import.meta.url))
// why each hash did not convert, so a compile does not try it again
const FAILED = Symbol.for('pcbjs.cli.models.failed')
const failed = (): Map<string, string> => ((globalThis as any)[FAILED] ??= new Map())

/** From the cache or one conversion in a child process; throws with the reason when it does not convert. */
function meshSync(hash: string, path: string, dir: string): Uint8Array {
  const bin = readMesh(hash, dir)
  if (bin) return bin
  if (!failed().has(hash)) {
    // a hung conversion must not hold the compile: two minutes, then the part keeps its default height
    const r = spawnSync(process.execPath, [MODEL_CHILD, hash, path, dir], { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8', timeout: 120_000 })
    const done = readMesh(hash, dir)
    if (done) return done
    failed().set(hash, r.error ? 'the conversion took over two minutes' : r.stderr.trim() || 'the conversion failed')
  }
  throw new Error(failed().get(hash))
}

/** In the model's own frame, from this process, the cache or a conversion in a child process; throws with the reason when it does not read. */
function meshBounds(hash: string, path: string, dir: string): Box3 {
  const hit = boundsMemo().get(hash)
  if (hit) return hit
  const b = bounds(meshFromBinary(meshSync(hash, path, dir)))
  boundsMemo().set(hash, b)
  return b
}

/** The model facet's mesh extents for this project; see SiteOptions.meshBounds. */
export const meshBoundsOf =
  (root: string): MeshBounds =>
  (hash, path) =>
    meshBounds(hash, path, modelsDir(root))

const orNull = <T>(f: () => T): T | null => {
  try {
    return f()
  } catch {
    return null
  }
}

/** See CompileOptions.modelBox: synchronous, so a new file converts once in a child process; it also points the model fetch at this project. */
export function modelBoxLoader(root: string): ModelBoxLoader {
  installModelFetch(root)
  return spec => {
    const hash = spec.path ? stepMeshKey(spec.path) : null
    if (!hash || !spec.path) return null
    const b = orNull(() => meshBounds(hash, spec.path!, modelsDir(root)))
    if (!b || !b.min.every(Number.isFinite) || !b.max.every(Number.isFinite)) return null
    const box = transformBox(modelMatrix({ offset: spec.offset ?? [0, 0, 0], rotate: spec.rotate ?? [0, 0, 0], scale: spec.scale ?? [1, 1, 1] }), b)
    return { min: box.min, max: box.max }
  }
}

/** The model files of a board's parts by mesh hash. */
function modelPaths(board: Board): Map<string, string> {
  const out = new Map<string, string>()
  for (const fp of board.footprints) {
    const m = fp.model
    if (!isFileModel(m) || !m.path) continue
    const hash = stepMeshKey(m.path)
    if (hash) out.set(hash, m.path)
  }
  return out
}

/** The GLB's key part from files: the mesh hash of every part's model file. */
export const glbInputs = (board: Board): string => [...modelPaths(board).keys()].sort().join()

const decode = (bin: Uint8Array | null) => {
  try {
    return bin ? meshFromBinary(bin) : null
  } catch {
    return null
  }
}

// @pcbjs/ui is built after this package, so its types are not read here; it loads on the first generated mesh
const UI_MODELS: string = '@pcbjs/ui/models'
type UiModels = { modelMeshes(spec: GeneratedSpec, ctx: ModelCtx): StepModel }
let ui: UiModels | null = null
const uiModels = (): UiModels => (ui ??= createRequire(import.meta.url)(UI_MODELS) as UiModels)

/** A generated body's mesh, from the project, the user cache, or made by @pcbjs/ui's generators once and written to both. */
export function generatedMesh(hash: string, spec: GeneratedSpec, ctx: ModelCtx, dir: string): Uint8Array {
  const hit = readMesh(hash, dir)
  if (hit) return hit
  const bin = meshToBinary(uiModels().modelMeshes(spec, ctx))
  writeMesh(hash, `generated:${spec.kind}`, dir, bin)
  return bin
}

/** The generated bodies of a board's parts by mesh hash, with what each is drawn for. */
function generatedBodies(site: SiteData): Map<string, { spec: GeneratedSpec; ctx: ModelCtx }> {
  const out = new Map<string, { spec: GeneratedSpec; ctx: ModelCtx }>()
  for (const fp of site.footprints) {
    const spec = generatedOf(fp.model)
    if (fp.mesh && spec) out.set(fp.mesh, { spec, ctx: { height: fp.height, thickness: site.thickness } })
  }
  return out
}

/** A part's mesh by hash: a model file's from the cache or one conversion, a generated body's from the cache or made once. */
export function partMeshes(root: string, board: Board, site: SiteData): (hash: string) => StepModel | null {
  const paths = modelPaths(board)
  const made = generatedBodies(site)
  const dir = modelsDir(root)
  return hash => {
    const body = made.get(hash)
    if (body) return decode(orNull(() => generatedMesh(hash, body.spec, body.ctx, dir)))
    return decode(paths.has(hash) ? orNull(() => meshSync(hash, paths.get(hash)!, dir)) : readMesh(hash, dir))
  }
}

/** The GLB exporter's meshes: a part's as partMeshes gives it, a referenced board's from its cache. */
export function glbMeshes(root: string, board: Board, site: SiteData): GlbInputs {
  return { mesh: partMeshes(root, board, site), reference: hash => decode(referenceMesh(hash)) }
}

/** Says which parts wait for a model the fetch has not brought yet. */
export function warnFetching(compiled: Iterable<Compiled>): void {
  for (const c of compiled) {
    const waiting = c.site.footprints.flatMap(sf => (sf.model?.kind === 'box' && sf.model.fetch ? [{ ref: sf.ref, source: sf.model.fetch }] : []))
    const notice = fetchNotice(c.board.name, waiting)
    if (notice) console.warn(notice)
  }
}
