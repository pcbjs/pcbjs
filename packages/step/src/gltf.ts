// glTF 2.0 and GLB to meshes: metres with y up become KiCad's mm with z up, (x, y, z) to (1000 x, -1000 z, 1000 y).
import { DEFAULT_COLOR, type StepMesh, type StepModel } from './mesh.js'
import { creaseMesh, groupByColor } from './tri.js'

type Mat = number[]
const IDENT: Mat = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
function mul(a: Mat, b: Mat): Mat {
  const o = new Array(16).fill(0)
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s }
  return o
}
/** A glTF node's TRS as a column-major matrix. */
function trs(t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]): Mat {
  const [x, y, z, w] = q
  const r = [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)]
  return [r[0] * s[0], r[1] * s[0], r[2] * s[0], 0, r[3] * s[1], r[4] * s[1], r[5] * s[1], 0, r[6] * s[2], r[7] * s[2], r[8] * s[2], 0, t[0], t[1], t[2], 1]
}

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }

function unpackGlb(b: Uint8Array): { json: any; bin: Uint8Array | null } {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  if (dv.getUint32(4, true) !== 2) throw new Error(`glTF binary version ${dv.getUint32(4, true)}, only 2 is read`)
  let off = 12, json: any = null, bin: Uint8Array | null = null
  while (off + 8 <= b.length) {
    const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true)
    const chunk = b.subarray(off + 8, off + 8 + len)
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk))
    else if (type === 0x004e4942 && !bin) bin = chunk
    off += 8 + len + ((4 - (len % 4)) % 4)
  }
  if (!json) throw new Error('glTF binary has no JSON chunk')
  return { json, bin }
}

function dataUri(uri: string): Uint8Array {
  const comma = uri.indexOf(',')
  const head = uri.slice(0, comma), body = uri.slice(comma + 1)
  return head.endsWith(';base64') ? new Uint8Array(Buffer.from(body, 'base64')) : new TextEncoder().encode(decodeURIComponent(body))
}

/** `readFile` loads a buffer stored in a file beside the model, by its URI. */
export interface GltfOptions { readFile?: (uri: string) => Uint8Array }

/** Read a glTF or GLB file's content into meshes in millimetres, z up. */
export function gltfToMesh(content: Uint8Array, opts: GltfOptions = {}): StepModel {
  const glb = content.length >= 4 && String.fromCharCode(...content.subarray(0, 4)) === 'glTF'
  let parsed: { json: any; bin: Uint8Array | null }
  if (glb) parsed = unpackGlb(content)
  else {
    try { parsed = { json: JSON.parse(new TextDecoder().decode(content)), bin: null } } catch { throw new Error('not glTF: neither a GLB header nor JSON') }
  }
  const { json, bin } = parsed
  const req: string[] = json.extensionsRequired ?? []
  const compression = req.find(e => /draco|meshopt/i.test(e))
  if (compression) throw new Error(`glTF uses ${compression}; export it again without mesh compression`)
  const buffers: Uint8Array[] = (json.buffers ?? []).map((b: any, i: number) => {
    if (b.uri === undefined) { if (i === 0 && bin) return bin; throw new Error(`glTF buffer ${i} has no data`) }
    if (b.uri.startsWith('data:')) return dataUri(b.uri)
    if (!opts.readFile) throw new Error(`glTF buffer ${b.uri} is a separate file; give the path of the .gltf, or use a .glb`)
    return opts.readFile(decodeURIComponent(b.uri))
  })
  const accessor = (i: number): { data: Float64Array; n: number; size: number } => {
    const a = json.accessors?.[i]
    if (!a) throw new Error(`glTF accessor ${i} is missing`)
    const size = COMPONENTS[a.type] ?? 1, n = a.count
    const data = new Float64Array(n * size)
    if (a.bufferView === undefined) return { data, n, size }
    const v = json.bufferViews[a.bufferView], buf = buffers[v.buffer]
    const dv = new DataView(buf.buffer, buf.byteOffset + (v.byteOffset ?? 0) + (a.byteOffset ?? 0))
    const bytes: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }
    const width = bytes[a.componentType]
    if (!width) throw new Error(`glTF accessor ${i} has component type ${a.componentType}`)
    const stride = v.byteStride ?? width * size
    for (let e = 0; e < n; e++) for (let c = 0; c < size; c++) {
      const o = e * stride + c * width
      data[e * size + c] = a.componentType === 5126 ? dv.getFloat32(o, true) : a.componentType === 5125 ? dv.getUint32(o, true) : a.componentType === 5123 ? dv.getUint16(o, true)
        : a.componentType === 5122 ? dv.getInt16(o, true) : a.componentType === 5121 ? dv.getUint8(o) : dv.getInt8(o)
    }
    return { data, n, size }
  }
  const color = (mi: number | undefined): [number, number, number] => {
    const f = mi === undefined ? undefined : json.materials?.[mi]?.pbrMetallicRoughness?.baseColorFactor
    return f ? [f[0], f[1], f[2]] : DEFAULT_COLOR
  }
  const out: StepMesh[] = []
  // metres, y up, to millimetres, z up
  const root: Mat = [1000, 0, 0, 0, 0, 0, 1000, 0, 0, -1000, 0, 0, 0, 0, 0, 1]
  const visit = (ni: number, parent: Mat, depth: number) => {
    const node = json.nodes?.[ni]
    if (!node || depth > 64) return
    const m = mul(parent, node.matrix ?? trs(node.translation, node.rotation, node.scale))
    const mesh = node.mesh !== undefined ? json.meshes?.[node.mesh] : undefined
    for (const p of mesh?.primitives ?? []) {
      const mode = p.mode ?? 4
      if (p.attributes?.POSITION === undefined || (mode !== 4 && mode !== 5 && mode !== 6)) continue
      const pos = accessor(p.attributes.POSITION)
      let ix: number[] = p.indices !== undefined ? Array.from(accessor(p.indices).data) : Array.from({ length: pos.n }, (_, i) => i)
      if (mode === 5) { const t: number[] = []; for (let i = 2; i < ix.length; i++) t.push(...(i % 2 ? [ix[i - 1], ix[i - 2], ix[i]] : [ix[i - 2], ix[i - 1], ix[i]])); ix = t }
      if (mode === 6) { const t: number[] = []; for (let i = 2; i < ix.length; i++) t.push(ix[0], ix[i - 1], ix[i]); ix = t }
      const positions = new Float32Array(pos.n * 3)
      for (let i = 0; i < pos.n; i++) {
        const x = pos.data[i * 3], y = pos.data[i * 3 + 1], z = pos.data[i * 3 + 2]
        for (let k = 0; k < 3; k++) positions[i * 3 + k] = m[k] * x + m[4 + k] * y + m[8 + k] * z + m[12 + k]
      }
      // a mirroring transform turns the triangles inside out; swap two corners to keep them facing out
      const det = m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2])
      if (det < 0) for (let i = 0; i < ix.length; i += 3) [ix[i + 1], ix[i + 2]] = [ix[i + 2], ix[i + 1]]
      if (p.attributes.NORMAL === undefined) { out.push({ ...creaseMesh(positions, ix), color: color(p.material) }); continue }
      const nor = accessor(p.attributes.NORMAL), normals = new Float32Array(pos.n * 3)
      for (let i = 0; i < pos.n; i++) {
        const x = nor.data[i * 3], y = nor.data[i * 3 + 1], z = nor.data[i * 3 + 2]
        const v = [0, 1, 2].map(k => m[k] * x + m[4 + k] * y + m[8 + k] * z), l = Math.hypot(v[0], v[1], v[2]) || 1
        for (let k = 0; k < 3; k++) normals[i * 3 + k] = v[k] / l
      }
      out.push({ positions, normals, indices: new Uint32Array(ix), color: color(p.material) })
    }
    for (const c of node.children ?? []) visit(c, m, depth + 1)
  }
  const scene = json.scenes?.[json.scene ?? 0]
  const roots: number[] = scene?.nodes ?? (json.nodes ?? []).map((_: unknown, i: number) => i).filter((i: number) => !(json.nodes as any[]).some(n => n.children?.includes(i)))
  for (const r of roots) visit(r, mul(root, IDENT), 0)
  return { meshes: groupByColor(out) }
}
