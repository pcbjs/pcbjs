// What the renderer needs of the board's GLB beyond the bytes: node indices by name, the explode vectors and the per-item
// selection geometry the copper nodes carry as accessors, decoded into the arrays the renderer's load option takes.
import type { SelectionGeometry } from '@pcbjs/renderer'

type Vec3 = [number, number, number]

export interface GlbNode {
  index: number
  name: string
  kind?: string
  layer?: string
  /** metres at full explode, its own offset without its parents' */
  explode: Vec3
  hasMesh: boolean
  children: number[]
}

export interface GlbScene {
  nodes: GlbNode[]
  byName: Map<string, number[]>
  selection: SelectionGeometry[]
  /** the uids with selection geometry */
  items: Set<string>
}

/** The renderer's bound on selection items and their bytes. */
const MAX_ITEMS = 65536,
  MAX_BYTES = 64 * 1024 * 1024

function chunks(bytes: Uint8Array): { json: any; bin: Uint8Array } {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('the board GLB has no glTF header')
  const jsonLen = dv.getUint32(12, true)
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLen)))
  const at = 20 + jsonLen
  const bin = at + 8 <= bytes.length ? bytes.subarray(at + 8, at + 8 + dv.getUint32(at, true)) : new Uint8Array(0)
  return { json, bin }
}

/** A VEC3 float accessor copied out of the binary chunk. */
function vec3(json: any, bin: Uint8Array, index: number): Float32Array {
  const a = json.accessors[index]
  const v = json.bufferViews[a.bufferView]
  if (a.componentType !== 5126 || a.type !== 'VEC3') throw new Error(`accessor ${index} is not VEC3 floats`)
  const start = bin.byteOffset + (v.byteOffset ?? 0) + (a.byteOffset ?? 0)
  return new Float32Array(bin.buffer.slice(start, start + a.count * 12))
}

const indices = (n: number): Uint32Array => Uint32Array.from({ length: n }, (_, i) => i)

/** The nodes and selection geometry of a board GLB; the copper nodes carry no transform, so their accessors are in world space. */
export function readGlb(bytes: Uint8Array): GlbScene {
  const { json, bin } = chunks(bytes)
  const nodes: GlbNode[] = (json.nodes ?? []).map((n: any, index: number) => ({
    index,
    name: n.name ?? '',
    kind: n.extras?.pcbjs?.kind,
    layer: n.extras?.pcbjs?.layer,
    explode: (n.extras?.pcbjs?.explode as Vec3 | undefined) ?? [0, 0, 0],
    hasMesh: n.mesh !== undefined,
    children: n.children ?? [],
  }))
  const byName = new Map<string, number[]>()
  for (const n of nodes) byName.set(n.name, [...(byName.get(n.name) ?? []), n.index])
  const selection: SelectionGeometry[] = []
  const items = new Set<string>()
  let size = 0
  for (const [index, n] of (json.nodes ?? []).entries())
    for (const it of n.extras?.pcbjs?.items ?? []) {
      if (selection.length >= MAX_ITEMS || items.has(it.uid)) continue
      const positions = vec3(json, bin, it.accessor)
      size += positions.byteLength * 2
      if (size > MAX_BYTES) break
      selection.push({ id: it.uid, node: index, positions, indices: indices(positions.length / 3) })
      items.add(it.uid)
    }
  return { nodes, byName, selection, items }
}

/** The node and its descendants that hold a mesh. */
export function meshed(scene: GlbScene, index: number): boolean {
  const n = scene.nodes[index]
  return n.hasMesh || n.children.some(c => meshed(scene, c))
}
