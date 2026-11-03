// @pcbjs/export/compose: boards a library built with `pcbjs build --lib` ships, placed as reference() places them relative to the
// first and written as one GLB, each board under a node `board:<name>`. docs/library.md.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ReferencedBoard, ReferencedFootprint, ReferenceOptions } from '@pcbjs/core/internal/reference'
import type { BoardRef } from '@pcbjs/core/site-facets'
import type { MatePoint } from '@pcbjs/core/model'
import { anchorTransform, IDENTITY4, mateTransform, mul4, type MateGeometry } from '@pcbjs/compile/internal/reference'
import { mm } from '@pcbjs/core/internal/units'

type Mat4 = number[]

/** a library board's GLB, beside its reference.json */
const GLB = 'model.glb'

/** A board and where it goes: `mate` against a part of the first board, by its ref such as `J1` or `J1/5`, or `at`; the first board stays where it is. */
export interface Placed extends Omit<ReferenceOptions, 'show'> {
  /** a library board: its folder or `reference.json`, as a path or URL, or the `board` its `index.js` exports */
  board: string | BoardRef
}

export interface ComposeOptions {
  format: 'glb'
}

interface Loaded {
  name: string
  rb: ReferencedBoard
  glb: Uint8Array
}

async function bytes(at: string): Promise<Uint8Array> {
  if (/^https?:/.test(at)) {
    const r = await fetch(at)
    if (!r.ok) throw new Error(`${at}: HTTP ${r.status}`)
    return new Uint8Array(await r.arrayBuffer())
  }
  return new Uint8Array(readFileSync(at.startsWith('file:') ? fileURLToPath(at) : at))
}

/** The reference data and GLB of a library board. */
async function load(b: Placed['board']): Promise<Loaded> {
  let ref: string, glb: string
  if (typeof b === 'string') {
    const file = b.startsWith('file:') ? fileURLToPath(b) : b
    ref = /^https?:/.test(file) || file.endsWith('.json') ? file : join(file, 'reference.json')
    glb = /^https?:/.test(ref) ? new URL(GLB, ref).href : join(dirname(ref), GLB)
  } else {
    if (!b.reference || !b.model) throw new Error(`compose(): ${b.board} is no library board; it needs the reference and model URLs that pcbjs build --lib writes`)
    ref = b.reference
    glb = b.model
  }
  const data = JSON.parse(new TextDecoder().decode(await bytes(ref))) as ReferencedBoard & { format?: number }
  return { name: data.name, rb: data, glb: await bytes(glb) }
}

const num = (v: unknown, what: string): number => {
  const x = mm(v as any)
  if (!Number.isFinite(x)) throw new Error(`compose(): ${what} must be a length, got ${JSON.stringify(v)}`)
  return x
}
const triple = (v: unknown, what: string): [number, number, number] => {
  if (!Array.isArray(v) || v.length < 2 || v.length > 3) throw new Error(`compose(): ${what} must be [x, y] or [x, y, z], got ${JSON.stringify(v)}`)
  return [num(v[0], what), num(v[1], what), v[2] === undefined ? 0 : num(v[2], what)]
}

/** The pad of a part by number or name. */
function padOf(fp: ReferencedFootprint, pin: string, board: string): ReferencedFootprint['pads'][number] {
  const pad = fp.pads.find(p => p.num === pin) ?? fp.pads.find(p => p.name === pin)
  if (!pad) throw new Error(`compose(): ${board} ${fp.ref} has no pin ${pin}; its pads are ${[...new Set(fp.pads.map(p => p.num))].join(', ')}`)
  return pad
}

/** Where a board goes in the first board's 3D frame, as reference() computes it. */
export function placement(base: ReferencedBoard, rb: ReferencedBoard, p: Omit<Placed, 'board'>): Mat4 {
  const rotate = p.rotate ?? 0
  const offset = p.offset ? triple(p.offset, 'offset') : ([0, 0, 0] as [number, number, number])
  if (p.mate === undefined) {
    if (p.at === undefined) throw new Error(`compose(): ${rb.name} needs mate or at`)
    return anchorTransform([1, 0, 0, 1, 0, 0], triple(p.at, 'at'), rotate, !!p.flip, offset, rb.thickness)
  }
  const m = Array.isArray(p.mate) ? p.mate[0] : p.mate
  if (typeof m.local !== 'string') throw new Error(`compose(): mate.local names a part of ${base.name} by its ref, such as 'J1' or 'J1/5'`)
  const [lref, lpin] = m.local.split('/')
  const lfp = base.footprints.find(f => f.ref === lref)
  if (!lfp) throw new Error(`compose(): ${base.name} has no part ${lref}`)
  const lpad = padOf(lfp, String(lpin ?? m.pin ?? '1'), base.name)
  const point: MatePoint | undefined = rb.mates?.find(q => q.name === m.remote)
  let remote: MateGeometry['remote']
  if (point) remote = { side: point.side, rot: point.rot, pin: point.at, thickness: rb.thickness }
  else {
    const rfp = rb.footprints.find(f => f.ref === m.remote)
    if (!rfp) throw new Error(`compose(): ${rb.name} has no part ${m.remote}`)
    remote = { side: rfp.side, rot: rfp.rot, pin: padOf(rfp, String(m.pin ?? lpin ?? '1'), rb.name).at, thickness: rb.thickness }
  }
  const stack = p.stack === 'coplanar' ? 'coplanar' : (p.side ?? lfp.side) === 'B' ? 'below' : 'above'
  return mateTransform({
    local: { side: lfp.side, rot: lfp.rot, pin: lpad.at, thickness: base.thickness },
    remote,
    stack,
    gap: p.gap === undefined ? lfp.height : num(p.gap, 'gap'),
    rotate,
    offset,
  })
}

/** The 3D view's frame, mm with y board -y and z up, to the GLB's metres with y up, and back. */
const C: Mat4 = [1e-3, 0, 0, 0, 0, 0, -1e-3, 0, 0, 1e-3, 0, 0, 0, 0, 0, 1]
const C_INV: Mat4 = [1e3, 0, 0, 0, 0, 0, 1e3, 0, 0, -1e3, 0, 0, 0, 0, 0, 1]
/** A transform of the 3D view's frame as a GLB node matrix. */
export const glbMatrix = (t: Mat4): Mat4 => mul4(mul4(C, t), C_INV).map(v => (Math.abs(v) < 1e-12 ? 0 : v))

/** Boards in one GLB, the first at the origin and each later one placed against it. */
export async function compose(boards: Placed[], opts: ComposeOptions): Promise<Uint8Array> {
  if (opts?.format !== 'glb') throw new Error(`compose(): format ${JSON.stringify(opts?.format)} is not written; 'glb' is, and STEP joins it with the board STEP writer`)
  if (!boards.length) throw new Error('compose(): no boards')
  const loaded = await Promise.all(boards.map(b => load(b.board)))
  const parts = loaded.map((l, i) => ({ name: l.name, glb: l.glb, matrix: glbMatrix(i === 0 ? IDENTITY4 : placement(loaded[0].rb, l.rb, boards[i])) }))
  return mergeGlb(parts)
}

type Json = Record<string, any>

/** The JSON and binary chunks of a GLB. */
export function readGlb(glb: Uint8Array): { json: Json; bin: Uint8Array } {
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength)
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB')
  let at = 12
  let json: Json | null = null
  let bin: Uint8Array = new Uint8Array()
  while (at < glb.byteLength) {
    const len = view.getUint32(at, true)
    const type = view.getUint32(at + 4, true)
    const body = glb.subarray(at + 8, at + 8 + len)
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(body))
    else if (type === 0x004e4942) bin = body
    at += 8 + len
  }
  if (!json) throw new Error('a GLB without its JSON chunk')
  return { json, bin }
}

const pad4 = (n: number) => (4 - (n % 4)) % 4

/** GLBs as one, the scene of each under a node of its name with its matrix. */
export function mergeGlb(parts: { name: string; glb: Uint8Array; matrix: Mat4 }[]): Uint8Array {
  const out: Json = { asset: { version: '2.0', generator: 'pcbjs compose' }, scene: 0, scenes: [{ nodes: [] as number[] }], nodes: [] as Json[] }
  const lists = ['bufferViews', 'accessors', 'meshes', 'materials', 'textures', 'images', 'samplers'] as const
  for (const k of lists) out[k] = []
  const bins: Uint8Array[] = []
  let size = 0
  for (const p of parts) {
    const { json, bin } = readGlb(p.glb)
    const base = Object.fromEntries([...lists, 'nodes'].map(k => [k, out[k].length])) as Record<(typeof lists)[number] | 'nodes', number>
    size += pad4(size)
    const binAt = size
    bins.push(bin)
    size += bin.byteLength
    for (const v of json.bufferViews ?? []) out.bufferViews.push({ ...v, buffer: 0, byteOffset: (v.byteOffset ?? 0) + binAt })
    for (const a of json.accessors ?? []) out.accessors.push({ ...a, ...(a.bufferView !== undefined ? { bufferView: a.bufferView + base.bufferViews } : {}) })
    const tex = (t: Json | undefined) => (t ? { ...t, index: t.index + base.textures } : undefined)
    for (const m of json.materials ?? []) {
      const pbr = m.pbrMetallicRoughness
      out.materials.push({
        ...m,
        ...(pbr
          ? {
              pbrMetallicRoughness: {
                ...pbr,
                ...(pbr.baseColorTexture ? { baseColorTexture: tex(pbr.baseColorTexture) } : {}),
                ...(pbr.metallicRoughnessTexture ? { metallicRoughnessTexture: tex(pbr.metallicRoughnessTexture) } : {}),
              },
            }
          : {}),
        ...(m.normalTexture ? { normalTexture: tex(m.normalTexture) } : {}),
        ...(m.occlusionTexture ? { occlusionTexture: tex(m.occlusionTexture) } : {}),
        ...(m.emissiveTexture ? { emissiveTexture: tex(m.emissiveTexture) } : {}),
      })
    }
    for (const m of json.meshes ?? [])
      out.meshes.push({
        ...m,
        primitives: m.primitives.map((q: Json) => ({
          ...q,
          attributes: Object.fromEntries(Object.entries(q.attributes).map(([k, v]) => [k, (v as number) + base.accessors])),
          ...(q.indices !== undefined ? { indices: q.indices + base.accessors } : {}),
          ...(q.material !== undefined ? { material: q.material + base.materials } : {}),
        })),
      })
    for (const t of json.textures ?? [])
      out.textures.push({ ...t, ...(t.source !== undefined ? { source: t.source + base.images } : {}), ...(t.sampler !== undefined ? { sampler: t.sampler + base.samplers } : {}) })
    for (const im of json.images ?? []) out.images.push({ ...im, ...(im.bufferView !== undefined ? { bufferView: im.bufferView + base.bufferViews } : {}) })
    for (const s of json.samplers ?? []) out.samplers.push(s)
    for (const n of json.nodes ?? [])
      out.nodes.push({ ...n, ...(n.mesh !== undefined ? { mesh: n.mesh + base.meshes } : {}), ...(n.children ? { children: n.children.map((c: number) => c + base.nodes) } : {}) })
    const roots = (json.scenes?.[json.scene ?? 0]?.nodes ?? []).map((r: number) => r + base.nodes)
    out.nodes.push({ name: `board:${p.name}`, matrix: p.matrix, children: roots })
    out.scenes[0].nodes.push(out.nodes.length - 1)
  }
  for (const k of lists) if (!out[k].length) delete out[k]
  if (size) out.buffers = [{ byteLength: size + pad4(size) }]
  const text = new TextEncoder().encode(JSON.stringify(out))
  const jsonLen = text.byteLength + pad4(text.byteLength)
  const binLen = size + pad4(size)
  const total = 12 + 8 + jsonLen + (size ? 8 + binLen : 0)
  const glb = new Uint8Array(total)
  const view = new DataView(glb.buffer)
  view.setUint32(0, 0x46546c67, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, total, true)
  view.setUint32(12, jsonLen, true)
  view.setUint32(16, 0x4e4f534a, true)
  glb.set(text, 20)
  glb.fill(0x20, 20 + text.byteLength, 20 + jsonLen)
  if (size) {
    let at = 20 + jsonLen
    view.setUint32(at, binLen, true)
    view.setUint32(at + 4, 0x004e4942, true)
    at += 8
    let off = 0
    for (const b of bins) {
      off += pad4(off)
      glb.set(b, at + off)
      off += b.byteLength
    }
  }
  return glb
}
