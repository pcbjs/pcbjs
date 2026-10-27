// The cached and served mesh binary. Little-endian, every block on a 4-byte boundary:
//   header   "PCBM", u16 version 1, u16 0, u32 mesh count
//   per mesh f32 r, g, b (linear), u32 vertex count, u32 index count, u32 index size 2 or 4
//            f32 positions, 3 per vertex; i8 normals, 3 per vertex scaled by 127, padded; u16 or u32 indices, padded
import type { StepMesh, StepModel } from './mesh.js'

const MAGIC = 0x4d424350 // "PCBM" read as a little-endian u32
const VERSION = 1
const pad4 = (n: number) => (n + 3) & ~3

export function meshToBinary(model: StepModel): Uint8Array {
  let size = 12
  for (const m of model.meshes) {
    const n = m.positions.length / 3, wide = n > 0xffff
    size += 24 + n * 12 + pad4(n * 3) + pad4(m.indices.length * (wide ? 4 : 2))
  }
  const buf = new ArrayBuffer(size)
  const dv = new DataView(buf)
  dv.setUint32(0, MAGIC, true); dv.setUint16(4, VERSION, true); dv.setUint16(6, 0, true); dv.setUint32(8, model.meshes.length, true)
  let off = 12
  for (const m of model.meshes) {
    const n = m.positions.length / 3, wide = n > 0xffff
    dv.setFloat32(off, m.color[0], true); dv.setFloat32(off + 4, m.color[1], true); dv.setFloat32(off + 8, m.color[2], true)
    dv.setUint32(off + 12, n, true); dv.setUint32(off + 16, m.indices.length, true); dv.setUint32(off + 20, wide ? 4 : 2, true)
    off += 24
    for (let i = 0; i < n * 3; i++) dv.setFloat32(off + i * 4, m.positions[i], true)
    off += n * 12
    for (let i = 0; i < n * 3; i++) dv.setInt8(off + i, Math.max(-127, Math.min(127, Math.round((m.normals[i] ?? 0) * 127))))
    off += pad4(n * 3)
    if (wide) for (let i = 0; i < m.indices.length; i++) dv.setUint32(off + i * 4, m.indices[i], true)
    else for (let i = 0; i < m.indices.length; i++) dv.setUint16(off + i * 2, m.indices[i], true)
    off += pad4(m.indices.length * (wide ? 4 : 2))
  }
  return new Uint8Array(buf)
}

/** Decode the binary of meshToBinary; normals come back unit length to a byte's precision. */
export function meshFromBinary(data: ArrayBuffer | ArrayBufferView): StepModel {
  const view = data instanceof ArrayBuffer ? new DataView(data) : new DataView(data.buffer, data.byteOffset, data.byteLength)
  if (view.byteLength < 12 || view.getUint32(0, true) !== MAGIC) throw new Error('not a pcbjs mesh: the header is missing')
  const version = view.getUint16(4, true)
  if (version !== VERSION) throw new Error(`pcbjs mesh version ${version}, this reader knows ${VERSION}`)
  const count = view.getUint32(8, true)
  const meshes: StepMesh[] = []
  let off = 12
  const need = (n: number) => { if (off + n > view.byteLength) throw new Error('pcbjs mesh is truncated') }
  for (let k = 0; k < count; k++) {
    need(24)
    const color: [number, number, number] = [view.getFloat32(off, true), view.getFloat32(off + 4, true), view.getFloat32(off + 8, true)]
    const n = view.getUint32(off + 12, true), ni = view.getUint32(off + 16, true), indexSize = view.getUint32(off + 20, true)
    if (indexSize !== 2 && indexSize !== 4) throw new Error(`pcbjs mesh has an index size of ${indexSize}`)
    off += 24
    need(n * 12 + pad4(n * 3) + pad4(ni * indexSize))
    const positions = new Float32Array(n * 3)
    for (let i = 0; i < n * 3; i++) positions[i] = view.getFloat32(off + i * 4, true)
    off += n * 12
    const normals = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      const x = view.getInt8(off + i * 3), y = view.getInt8(off + i * 3 + 1), z = view.getInt8(off + i * 3 + 2)
      const l = Math.hypot(x, y, z) || 1
      normals[i * 3] = x / l; normals[i * 3 + 1] = y / l; normals[i * 3 + 2] = z / l
    }
    off += pad4(n * 3)
    const indices = new Uint32Array(ni)
    for (let i = 0; i < ni; i++) indices[i] = indexSize === 4 ? view.getUint32(off + i * 4, true) : view.getUint16(off + i * 2, true)
    off += pad4(ni * indexSize)
    meshes.push({ positions, normals, indices, color })
  }
  return { meshes }
}
