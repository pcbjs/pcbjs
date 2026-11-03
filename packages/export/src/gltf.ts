// A glTF 2.0 document in one binary buffer, written as GLB: the subset @pcbjs/renderer and three.js read, triangles and metallic roughness only.

type Json = Record<string, unknown>
const FLOAT = 5126,
  UINT = 5125,
  USHORT = 5123
const ARRAY = 34962,
  ELEMENTS = 34963

export interface Material {
  name: string
  /** linear RGB */
  color: [number, number, number]
  alpha?: number
  metal?: number
  rough?: number
  doubleSided?: boolean
  /** linear RGB */
  emissive?: [number, number, number]
  /** a texture index for baseColorTexture */
  texture?: number
}

export interface Primitive {
  positions: Float32Array
  /** left out for flat faces, which a reader shades by their winding */
  normals?: Float32Array
  indices: Uint32Array
  uvs?: Float32Array
  material: number
}

export interface Node {
  name: string
  mesh?: number
  matrix?: number[]
  children?: number[]
  extras?: Json
}

export class Gltf {
  private chunks: Uint8Array[] = []
  private size = 0
  private views: Json[] = []
  private accessors: Json[] = []
  private materials: Json[] = []
  private meshes: Json[] = []
  private nodes: Json[] = []
  private images: Json[] = []
  private textures: Json[] = []
  private samplers: Json[] = []

  /** The bytes as a buffer view of their own, 4-byte aligned. */
  private view(bytes: Uint8Array, target?: number): number {
    const pad = (4 - (this.size % 4)) % 4
    if (pad) {
      this.chunks.push(new Uint8Array(pad))
      this.size += pad
    }
    this.views.push({ buffer: 0, byteOffset: this.size, byteLength: bytes.byteLength, ...(target ? { target } : {}) })
    this.chunks.push(bytes)
    this.size += bytes.byteLength
    return this.views.length - 1
  }

  /** A VEC3, VEC2 or SCALAR accessor over its own view; VEC3 positions carry min and max. */
  accessor(data: Float32Array | Uint32Array | Uint16Array, type: 'VEC3' | 'VEC2' | 'SCALAR', target?: number, bounds = false): number {
    const n = type === 'VEC3' ? 3 : type === 'VEC2' ? 2 : 1
    const view = this.view(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), target)
    const a: Json = { bufferView: view, componentType: data instanceof Uint32Array ? UINT : data instanceof Uint16Array ? USHORT : FLOAT, count: data.length / n, type }
    if (bounds) {
      const min = [Infinity, Infinity, Infinity],
        max = [-Infinity, -Infinity, -Infinity]
      for (let i = 0; i < data.length; i += 3)
        for (let k = 0; k < 3; k++) {
          if (data[i + k] < min[k]) min[k] = data[i + k]
          if (data[i + k] > max[k]) max[k] = data[i + k]
        }
      Object.assign(a, { min, max })
    }
    this.accessors.push(a)
    return this.accessors.length - 1
  }

  material(m: Material): number {
    const pbr: Json = {
      baseColorFactor: [...m.color, m.alpha ?? 1],
      metallicFactor: m.metal ?? 0,
      roughnessFactor: m.rough ?? 0.8,
      ...(m.texture !== undefined ? { baseColorTexture: { index: m.texture } } : {}),
    }
    this.materials.push({
      name: m.name,
      pbrMetallicRoughness: pbr,
      ...(m.alpha !== undefined && m.alpha < 1 ? { alphaMode: 'BLEND' } : {}),
      ...(m.doubleSided ? { doubleSided: true } : {}),
      ...(m.emissive ? { emissiveFactor: m.emissive } : {}),
    })
    return this.materials.length - 1
  }

  /** A PNG with trilinear mipmapped minification, clamped at the edges. */
  texture(png: Uint8Array): number {
    if (!this.samplers.length) this.samplers.push({ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 })
    this.images.push({ bufferView: this.view(png), mimeType: 'image/png' })
    this.textures.push({ sampler: 0, source: this.images.length - 1 })
    return this.textures.length - 1
  }

  /** A mesh of the primitives that have triangles; null when none has. */
  mesh(name: string, prims: Primitive[]): number | null {
    const list = prims.filter(p => p.indices.length)
    if (!list.length) return null
    this.meshes.push({
      name,
      primitives: list.map(p => ({
        attributes: {
          POSITION: this.accessor(p.positions, 'VEC3', ARRAY, true),
          ...(p.normals ? { NORMAL: this.accessor(p.normals, 'VEC3', ARRAY) } : {}),
          ...(p.uvs ? { TEXCOORD_0: this.accessor(p.uvs, 'VEC2', ARRAY) } : {}),
        },
        indices: this.accessor(p.positions.length / 3 <= 65536 ? Uint16Array.from(p.indices) : p.indices, 'SCALAR', ELEMENTS),
        material: p.material,
      })),
    })
    return this.meshes.length - 1
  }

  node(n: Node): number {
    this.nodes.push({
      name: n.name,
      ...(n.mesh !== undefined ? { mesh: n.mesh } : {}),
      ...(n.matrix ? { matrix: n.matrix } : {}),
      ...(n.children?.length ? { children: n.children } : {}),
      ...(n.extras ? { extras: n.extras } : {}),
    })
    return this.nodes.length - 1
  }

  /** Set the extras of a node already added, for one whose children came after it. */
  extras(node: number, extras: Json): void {
    this.nodes[node].extras = extras
  }

  /** The GLB of a scene of the root nodes. */
  glb(roots: number[], extras?: Json): Uint8Array {
    const json: Json = {
      asset: { version: '2.0', generator: 'pcbjs', ...(extras ? { extras } : {}) },
      scene: 0,
      scenes: [{ nodes: roots }],
      nodes: this.nodes,
      ...(this.meshes.length ? { meshes: this.meshes } : {}),
      ...(this.materials.length ? { materials: this.materials } : {}),
      ...(this.accessors.length ? { accessors: this.accessors, bufferViews: this.views } : {}),
      ...(this.images.length ? { images: this.images, textures: this.textures, samplers: this.samplers } : {}),
      ...(this.size ? { buffers: [{ byteLength: align(this.size) }] } : {}),
    }
    const text = new TextEncoder().encode(JSON.stringify(json))
    const jsonLen = align(text.length),
      binLen = this.size ? align(this.size) : 0
    const out = new Uint8Array(12 + 8 + jsonLen + (binLen ? 8 + binLen : 0))
    const dv = new DataView(out.buffer)
    dv.setUint32(0, 0x46546c67, true)
    dv.setUint32(4, 2, true)
    dv.setUint32(8, out.length, true)
    dv.setUint32(12, jsonLen, true)
    dv.setUint32(16, 0x4e4f534a, true)
    out.set(text, 20)
    out.fill(0x20, 20 + text.length, 20 + jsonLen)
    if (binLen) {
      const at = 20 + jsonLen
      dv.setUint32(at, binLen, true)
      dv.setUint32(at + 4, 0x004e4942, true)
      let k = at + 8
      for (const c of this.chunks) {
        out.set(c, k)
        k += c.byteLength
      }
    }
    return out
  }
}

const align = (n: number) => (n + 3) & ~3
