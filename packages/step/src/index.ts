// Model files to triangle meshes, in Node: STEP through OpenCascade's WASM build occt-import-js, loaded on first use.
import { readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { DEFAULT_COLOR, type StepMesh, type StepModel, type StepOptions } from './mesh.js'
import { fullOptions } from './key.js'
import { flatNormals } from './tri.js'
import { modelFormat, type ModelFormat } from './format.js'
import { gltfToMesh } from './gltf.js'
import { wrlToMesh } from './wrl.js'

export * from './mesh.js'
export * from './format.js'
export { gltfToMesh } from './gltf.js'
export { wrlToMesh, WRL_UNIT_MM } from './wrl.js'
export { alignModel, guessUnit, type AlignPad, type AlignTarget, type AlignResult, type UnitGuess } from './align.js'
export { placementIssue, footprintRect, type Box3, type Rect, type StepTransform } from './place.js'
export { meshToBinary, meshFromBinary } from './binary.js'
export { meshKey, fullOptions, CONVERTER_VERSION } from './key.js'

interface OcctMesh {
  name?: string
  color?: [number, number, number]
  brep_faces: { first: number; last: number; color: [number, number, number] | null }[]
  attributes: { position: { array: ArrayLike<number> }; normal?: { array: ArrayLike<number> } }
  index: { array: ArrayLike<number> }
}
interface Occt { ReadStepFile(content: Uint8Array, params: Record<string, unknown> | null): { success: boolean; meshes: OcctMesh[] } }

// one OpenCascade per process, on globalThis like the other pcbjs state, so two copies of this package share the 8 MB WASM
const KEY = Symbol.for('pcbjs.step.occt')
function occt(): Promise<Occt> {
  const g = globalThis as any
  if (!g[KEY]) {
    const require = createRequire(import.meta.url)
    const init = require('occt-import-js') as () => Promise<Occt>
    g[KEY] = init().catch((e: unknown) => { g[KEY] = undefined; throw e })
  }
  return g[KEY]
}

/** The faces of one OpenCascade mesh split by colour: one StepMesh per colour, vertices renumbered. */
function splitByColor(m: OcctMesh): StepMesh[] {
  const pos = m.attributes.position.array, nor = m.attributes.normal?.array, idx = m.index.array
  const meshColor = m.color ?? DEFAULT_COLOR
  const groups = new Map<string, { color: [number, number, number]; tris: number[] }>()
  const faces = m.brep_faces.length ? m.brep_faces : [{ first: 0, last: idx.length / 3 - 1, color: null }]
  for (const f of faces) {
    const color = f.color ?? meshColor
    const key = color.map(c => c.toFixed(4)).join()
    let g = groups.get(key)
    if (!g) groups.set(key, g = { color: [color[0], color[1], color[2]], tris: [] })
    for (let t = f.first; t <= f.last; t++) g.tris.push(t)
  }
  const out: StepMesh[] = []
  for (const g of groups.values()) {
    const remap = new Map<number, number>()
    const p: number[] = [], n: number[] = [], ix: number[] = []
    for (const t of g.tris) for (let k = 0; k < 3; k++) {
      const v = idx[t * 3 + k]
      let w = remap.get(v)
      if (w === undefined) {
        w = remap.size
        remap.set(v, w)
        p.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2])
        if (nor) n.push(nor[v * 3], nor[v * 3 + 1], nor[v * 3 + 2])
      }
      ix.push(w)
    }
    const positions = new Float32Array(p), indices = new Uint32Array(ix)
    out.push({ positions, normals: nor ? new Float32Array(n) : flatNormals(positions, indices), indices, color: g.color })
  }
  return out
}

/** Triangulate a STEP file into mm in the file's frame, one mesh per colour of each solid. */
export async function stepToMesh(file: string | Uint8Array, opts: StepOptions = {}): Promise<StepModel> {
  const content = typeof file === 'string' ? new Uint8Array(await readFile(file)) : file
  const o = fullOptions(opts)
  const lib = await occt()
  const r = lib.ReadStepFile(content, { linearUnit: 'millimeter', linearDeflectionType: 'absolute_value', linearDeflection: o.linearDeflection, angularDeflection: o.angularDeflection })
  if (!r.success) throw new Error(`cannot read STEP${typeof file === 'string' ? ` file ${file}` : ''}: OpenCascade found no shape in it`)
  return { meshes: r.meshes.flatMap(splitByColor).filter(m => m.indices.length) }
}

export interface ModelOptions extends StepOptions {
  format?: ModelFormat
  /** the file name or path the content came from: its extension names the format, its folder holds a glTF's separate buffers */
  path?: string
}

/** Read a STEP, glTF, GLB or WRL file into meshes in mm, z up; the format comes from `format`, the extension or the first bytes. */
export async function modelToMesh(file: string | Uint8Array, opts: ModelOptions = {}): Promise<StepModel> {
  const path = typeof file === 'string' ? file : opts.path
  const content = typeof file === 'string' ? new Uint8Array(await readFile(file)) : file
  const format = opts.format ?? modelFormat(path, content)
  const where = path ? ` ${path}` : ''
  if (!format) throw new Error(`cannot tell the format of${where || ' the model'}: use a .step, .stp, .gltf, .glb or .wrl file`)
  try {
    if (format === 'step') return await stepToMesh(content, opts)
    if (format === 'wrl') return wrlToMesh(content)
    return gltfToMesh(content, { readFile: path ? uri => new Uint8Array(readFileSync(resolve(dirname(path), uri))) : undefined })
  } catch (e: any) {
    const msg = String(e?.message ?? e)
    throw new Error(msg.includes(where.trim()) && where ? msg : `cannot read ${format.toUpperCase()}${where}: ${msg}`)
  }
}
