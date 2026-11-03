// The board as one GLB for the renderer, diffs and downstream tools, from the viewer's own scene geometry; docs/export.md
// geometry is built in the viewer's frame, mm with x board x, y board -y and z up, then written in metres with y up: (x, y, z) to (x, z, -y) / 1000
import type { SiteData, SiteFootprint, SiteItem } from '@pcbjs/core/site-data'
import type { SiteReference } from '@pcbjs/core/internal/reference'
import type { StepModel } from '@pcbjs/step/internal/mesh'
import { mul, stepMatrix, type Mat4 } from '@pcbjs/step/internal/place'
import { Gltf, type Material, type Primitive } from './gltf.js'
import { flatten, holeOf, runJob, slabJob, type GeoResult } from './scene/geometry.js'
import { coveredOf, shapeOf } from '@pcbjs/core/site-shapes'
import { bodyFace, bodyMatrix, copperIds, copperSlices, maskCuts, maskInfo, maskThickness, MASK_FLARE, sliceOf, type MaskInfo, type Slice } from './scene/stack.js'
import { dielectrics, explodeGroup, offsets, stackOrder } from './scene/explode.js'
import { COLORS, FINISH, LED_CLEAR, LED_GLOW, LED_TINT, MASK_GAIN, MASK_OPACITY, sideColors } from './scene/colors.js'
import { rasterSync } from './raster.js'
import { pulse } from '@pcbjs/compile/internal/cancel'

type Ring = [number, number][]
type Rgb = [number, number, number]
type Side = 'F' | 'B'

/** mm between neighbouring stack groups at full explode, the viewer's default separation */
export const EXPLODE_SEP = 4
/** the face raster's resolution, px per mm, and its largest side */
const PX_PER_MM = 20,
  MAX_PX = 4096
/** a part without a model, drawn as its body box */
const BODY = '#2b2b2b'

export interface GlbInputs {
  /** a part's mesh by its hash, a model file's or a generated body's, null when it cannot be made */
  mesh(hash: string): StepModel | null
  /** a referenced board's mesh by its hash */
  reference(hash: string): StepModel | null
  /** one PNG per SVG, rasterSync when left out */
  raster?(svgs: string[]): Uint8Array[]
}

/** What a selection accessor names: an item of the board data on one copper layer. */
export interface GlbItem {
  uid: string
  kind: SiteItem['kind']
  net?: string
  accessor: number
}

const C: Mat4 = [1e-3, 0, 0, 0, 0, 0, -1e-3, 0, 0, 1e-3, 0, 0, 0, 0, 0, 1]

/** Viewer-frame mm to GLB metres, in place. */
function toGlb(a: Float32Array): Float32Array {
  for (let i = 0; i < a.length; i += 3) {
    const y = a[i + 1]
    a[i] *= 1e-3
    a[i + 1] = a[i + 2] * 1e-3
    a[i + 2] = -y * 1e-3
  }
  return a
}

const explodeOf = (z: number): [number, number, number] => [0, Math.round(z * 1e6) / 1e9, 0]
const extras = (kind: string, z: number, more: Record<string, unknown> = {}) => ({ pcbjs: { kind, ...more, explode: explodeOf(z) } })

/** Triangles as the jobs give them, gathered per material; their faces are flat, so they carry no normals and a reader computes them from the winding. */
class Soup {
  private parts = new Map<number, Float32Array[]>()
  add(material: number, pos: Float32Array): void {
    let p = this.parts.get(material)
    if (!p) this.parts.set(material, (p = []))
    p.push(pos)
  }
  /** a job's triangles lifted by `z0`, or with `z1` a unit extrusion stretched from z0 to z1 */
  job(material: number, r: GeoResult, z0: number, z1?: number): void {
    if (r.position) this.add(material, lift(r.position, z0, z1))
  }
  prims(uv?: (material: number) => ((x: number, y: number) => [number, number]) | undefined): Primitive[] {
    return [...this.parts].map(([material, p]) => prim(concat(p), material, uv?.(material)))
  }
}

function lift(p: Float32Array, z0: number, z1?: number): Float32Array {
  const out = p.slice()
  for (let i = 2; i < out.length; i += 3) out[i] = z1 === undefined ? z0 + out[i] : z0 + out[i] * (z1 - z0)
  return out
}

function concat(list: Float32Array[]): Float32Array {
  if (list.length === 1) return list[0]
  const out = new Float32Array(list.reduce((n, a) => n + a.length, 0))
  let k = 0
  for (const a of list) {
    out.set(a, k)
    k += a.length
  }
  return out
}

/** Corners at one position welded into one vertex, then written in GLB space. */
function prim(pos: Float32Array, material: number, uv?: (x: number, y: number) => [number, number]): Primitive {
  const pb = new Uint32Array(pos.buffer, pos.byteOffset, pos.length)
  const seen = new Map<string, number>()
  const p: number[] = []
  const indices = new Uint32Array(pos.length / 3)
  for (let v = 0, i = 0; i < pos.length; v++, i += 3) {
    const key = `${pb[i]},${pb[i + 1]},${pb[i + 2]}`
    let at = seen.get(key)
    if (at === undefined) {
      at = p.length / 3
      seen.set(key, at)
      p.push(pos[i], pos[i + 1], pos[i + 2])
    }
    indices[v] = at
  }
  const positions = new Float32Array(p)
  let uvs: Float32Array | undefined
  if (uv) {
    uvs = new Float32Array((positions.length / 3) * 2)
    for (let i = 0, k = 0; i < positions.length; i += 3, k += 2) [uvs[k], uvs[k + 1]] = uv(positions[i], positions[i + 1])
  }
  return { positions: toGlb(positions), indices, ...(uvs ? { uvs } : {}), material }
}

const rgbKey = (c: Rgb) => c.map(v => v.toFixed(3)).join()
const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const linearToSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055)

/** A CSS hex colour as linear RGB, null for anything else. */
function hex(c: string | null | undefined): Rgb | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c?.trim() ?? '')
  if (!m) return null
  const h = m[1].length === 3 ? [...m[1]].map(d => d + d).join('') : m[1]
  return [0, 2, 4].map(i => srgbToLinear(parseInt(h.slice(i, i + 2), 16) / 255)) as Rgb
}

function hsl([r, g, b]: Rgb): Rgb {
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l <= 0.5 ? d / (max + min) : d / (2 - max - min)
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h / 6, s, l]
}

function fromHsl([h, s, l]: Rgb): Rgb {
  if (s === 0) return [l, l, l]
  const q = l <= 0.5 ? l * (1 + s) : l + s - l * s,
    p = 2 * l - q
  const f = (t: number) => {
    t = (t + 1) % 1
    return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * 6 * (2 / 3 - t) : p
  }
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)]
}

/** The mask over bare laminate and over copper, as the viewer shades them. */
function maskShades(base: Rgb): { bare: Rgb; copper: Rgb } {
  const s = hsl(base)[1]
  const a = base.map(linearToSrgb),
    cu = hex(COLORS.copper)!.map(linearToSrgb)
  const k = 0.08 + 0.16 * s
  const mixed = hsl(a.map((v, i) => srgbToLinear(v + (cu[i] - v) * k)) as Rgb)
  const copper = fromHsl([mixed[0], mixed[1], mixed[2] + 0.03 + 0.03 * s])
  return { bare: base.map(v => v / MASK_GAIN) as Rgb, copper: copper.map(v => v / MASK_GAIN) as Rgb }
}

/** The face of one side as an SVG over the board box: the laminate, the finish where the mask opens, the edge cuts. */
function faceSvg(b: SiteData, side: Side, w: number, h: number): string {
  const bb = b.bbox
  const layer = (id: string) => b.layers.find(l => l.id === id)?.svg ?? ''
  const ring = (r: Ring) => `M${r.map(([x, y]) => `${x} ${y}`).join('L')}Z`
  const outline = b.outline.length ? b.outline.map(ring).join('') : `M${bb.x} ${bb.y}h${bb.w}v${bb.h}h${-bb.w}Z`
  const finish = FINISH[b.stackup?.finish ?? ''] ?? FINISH.HASL
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bb.x} ${bb.y} ${bb.w} ${bb.h}" width="${w}" height="${h}">` +
    `<path fill="${COLORS.fr4}" fill-rule="evenodd" d="${outline}"/>` +
    `<g color="${finish}" fill="currentColor">${layer(`${side}.Mask`)}</g>` +
    `<g color="${COLORS.edge}" fill="currentColor">${layer('Edge.Cuts')}</g></svg>`
  )
}

/** An open tube along a ring in board mm from z0 to z1, for a material drawn from both sides. */
function tube(ring: Ring, z0: number, z1: number): Float32Array {
  const n = ring.length,
    pos = new Float32Array(n * 18)
  for (let i = 0; i < n; i++) {
    const [ax, ay] = ring[i],
      [bx, by] = ring[(i + 1) % n]
    pos.set([ax, -ay, z0, bx, -by, z0, bx, -by, z1, ax, -ay, z0, bx, -by, z1, ax, -ay, z1], i * 18)
  }
  return pos
}

const circle = (c: [number, number], r: number): Ring => Array.from({ length: 20 }, (_, i) => [c[0] + r * Math.cos((i * Math.PI) / 10), c[1] + r * Math.sin((i * Math.PI) / 10)])

/** A box in the viewer frame, its faces wound outward: centre x, y, footprint rotation in degrees, size, from z0 to z1. */
function box(x: number, y: number, rot: number, w: number, h: number, z0: number, z1: number): Float32Array {
  const a = (rot * Math.PI) / 180,
    c = Math.cos(a),
    s = Math.sin(a)
  const at = (u: number, v: number, z: number) => [x + u * c - v * s, y + u * s + v * c, z]
  const pos: number[] = []
  const quad = (...q: number[][]) => {
    for (const i of [0, 1, 2, 0, 2, 3]) pos.push(...q[i])
  }
  const u = w / 2,
    v = h / 2
  quad(at(-u, -v, z1), at(u, -v, z1), at(u, v, z1), at(-u, v, z1))
  quad(at(-u, v, z0), at(u, v, z0), at(u, -v, z0), at(-u, -v, z0))
  quad(at(-u, -v, z0), at(u, -v, z0), at(u, -v, z1), at(-u, -v, z1))
  quad(at(u, v, z0), at(-u, v, z0), at(-u, v, z1), at(u, v, z1))
  quad(at(u, -v, z0), at(u, v, z0), at(u, v, z1), at(u, -v, z1))
  quad(at(-u, v, z0), at(-u, -v, z0), at(-u, -v, z1), at(-u, v, z1))
  return new Float32Array(pos)
}

/** The board of the site data as GLB bytes; see docs/export.md for the nodes and their extras. */
export function boardGlb(b: SiteData, inputs: GlbInputs): Uint8Array {
  const g = new Gltf()
  const slices = copperSlices(b)
  pulse()
  const mask = maskInfo(b, { F: maskThickness(b, 'F'), B: maskThickness(b, 'B') })
  const order = stackOrder(b)
  const off = offsets(order, EXPLODE_SEP)
  const at = (name: string) => off.get(name) ?? 0
  pulse()
  const mats = materials(g, b, inputs)
  const roots: number[] = []
  pulse()

  roots.push(slab(g, b, slices, mats, off))
  for (const name of order) {
    pulse()
    if (name.startsWith('diel:')) continue
    if (name.startsWith('bodies:')) roots.push(bodies(g, b, name.slice(-1) as Side, slices, mats, inputs, at(name)))
    else if (name.endsWith('.Mask')) roots.push(maskNode(g, b, name[0] as Side, slices, mask, mats, at(name)))
    else if (name.endsWith('.SilkS')) roots.push(silk(g, b, name[0] as Side, slices, mask, mats, at(name)))
    else roots.push(copper(g, b, name, slices.get(name)!, mats, at(name)))
  }
  roots.push(barrels(g, b, slices, mats, (at('B.Cu') + at('F.Cu')) / 2))
  for (const r of b.references ?? []) roots.push(reference(g, r, inputs, at(explodeGroup(r.side) ?? '')))
  return g.glb(roots, { pcbjs: { board: b.name, rev: b.rev, ...(b.variant ? { target: b.variant.name } : {}), units: 'm', separation: EXPLODE_SEP } })
}

interface Mats {
  get(name: string): number
  /** a model file's colour: light greys and golds metal, the rest plastic */
  step(c: Rgb): number
  /** a generated body's colour: an LED lens glowing in its own, else as a model file's */
  generated(c: Rgb): number
  face: Record<Side, number>
}

function materials(g: Gltf, b: SiteData, inputs: GlbInputs): Mats {
  const finish = hex(FINISH[b.stackup?.finish ?? ''] ?? FINISH.HASL)!
  const colors = sideColors(b.stackup)
  const maskBase = hex(colors.mask) ?? hex(COLORS.mask)!
  const shades = maskShades(maskBase)
  const silkColor = hex(colors.silk) ?? hex(COLORS.silk)!
  const defs: Record<string, Material> = {
    fr4: { name: 'fr4', color: hex(COLORS.fr4)!, rough: 0.7 },
    edge: { name: 'edge', color: hex(COLORS.edge)!, rough: 0.85 },
    'copper:outer': { name: 'copper:outer', color: finish, rough: 0.32, metal: 0.75 },
    'copper:inner': { name: 'copper:inner', color: hex(COLORS.copper)!, rough: 0.4, metal: 0.6 },
    barrel: { name: 'barrel', color: finish, rough: 0.35, metal: 0.7, doubleSided: true },
    silk: { name: 'silk', color: silkColor, rough: 0.8 },
    mask: { name: 'mask', color: shades.bare, rough: 0.55, alpha: MASK_OPACITY },
    'mask:copper': { name: 'mask:copper', color: shades.copper, rough: 0.55, alpha: MASK_OPACITY },
    body: { name: 'body', color: hex(BODY)!, rough: 0.6 },
  }
  const made = new Map<string, number>()
  const get = (name: string) => {
    let m = made.get(name)
    if (m === undefined) made.set(name, (m = g.material(defs[name])))
    return m
  }
  const bb = b.bbox
  const scale = Math.min(PX_PER_MM, MAX_PX / Math.max(bb.w, bb.h, 1e-3))
  const w = Math.max(1, Math.round(bb.w * scale)),
    h = Math.max(1, Math.round(bb.h * scale))
  const [front, back] = (inputs.raster ?? rasterSync)([faceSvg(b, 'F', w, h), faceSvg(b, 'B', w, h)])
  const face = {
    F: g.material({ name: 'face:F', color: [1, 1, 1], rough: 0.7, texture: g.texture(front) }),
    B: g.material({ name: 'face:B', color: [1, 1, 1], rough: 0.7, texture: g.texture(back) }),
  }
  const steps = new Map<string, number>()
  // light greys and golds are the metal of pins and shells, the rest plastic, as the viewer has it
  const step = (c: Rgb) => {
    const key = rgbKey(c)
    let m = steps.get(key)
    if (m === undefined) {
      const [hue, s, l] = hsl(c)
      const metal = l > 0.25 && (s < 0.15 || (hue > 0.08 && hue < 0.17 && s > 0.3))
      steps.set(key, (m = g.material({ name: `model:${key}`, color: c, rough: metal ? 0.35 : 0.6, metal: metal ? 0.7 : 0.05 })))
    }
    return m
  }
  const lenses = new Map<string, { color: string; clear: boolean }>([
    ...Object.values(LED_TINT).map(c => [rgbKey(hex(c)!), { color: c, clear: false }] as const),
    [rgbKey(hex(LED_CLEAR)!), { color: LED_CLEAR, clear: true }],
  ])
  const leds = new Map<string, number>()
  // an opaque lens with a mild glow in its own colour, as the viewer's
  const generated = (c: Rgb) => {
    const lens = lenses.get(rgbKey(c))
    if (!lens) return step(c)
    let m = leds.get(lens.color)
    if (m === undefined) {
      const glow = lens.clear ? LED_GLOW.clear : LED_GLOW.tinted
      leds.set(lens.color, (m = g.material({ name: `led:${lens.color}`, color: c, rough: 0.25, emissive: c.map(v => v * glow) as Rgb })))
    }
    return m
  }
  return { get, step, generated, face }
}

/** `board`: the dielectric slices between the copper layers, each its stack group; the outer faces carry the face rasters. */
function slab(g: Gltf, b: SiteData, slices: Map<string, Slice>, mats: Mats, off: Map<string, number>): number {
  const bb = b.bbox
  const uv = (x: number, y: number): [number, number] => [(x - bb.x) / bb.w, (-y - bb.y) / bb.h]
  const diel = dielectrics(b, slices)
  const children = diel.map((d, i) => {
    pulse()
    const r = runJob(slabJob(b, d.z1 - d.z0, b.drills, []))
    const soup = new Soup()
    if (r.position) {
      const p = lift(r.position, d.z0)
      for (let k = 0; k < r.groups.length; k += 3) {
        const [start, count, group] = [r.groups[k], r.groups[k + 1], r.groups[k + 2]]
        for (let t = start; t < start + count; t += 3) {
          const nz = r.normal![t * 3 + 2]
          const m = group === 1 ? mats.get('edge') : nz > 0.5 && i === 0 ? mats.face.F : nz < -0.5 && i === diel.length - 1 ? mats.face.B : mats.get('fr4')
          soup.add(m, p.subarray(t * 3, t * 3 + 9))
        }
      }
    }
    const mesh = g.mesh(
      d.name,
      soup.prims(m => (m === mats.face.F || m === mats.face.B ? uv : undefined)),
    )
    return g.node({ name: d.name, ...(mesh !== null ? { mesh } : {}), extras: extras('dielectric', off.get(d.name) ?? 0, { layer: d.name }) })
  })
  return g.node({ name: 'board', children, extras: extras('board', 0) })
}

/** The lid of a unit extrusion that faces `dir` along z, at height z: an item's selection geometry, its face away from the board. */
function outerLid(r: GeoResult, z: number, dir: 1 | -1): Float32Array {
  if (!r.position) return new Float32Array(0)
  const out: number[] = []
  for (let i = 0; i < r.position.length; i += 9) if (r.normal![i + 2] * dir > 0.5) for (let k = 0; k < 9; k += 3) out.push(r.position[i + k], r.position[i + k + 1], z)
  return new Float32Array(out)
}

/** The copper of a net on a layer, its items unioned less their drills; the netless ones together. */
function copper(g: Gltf, b: SiteData, layer: string, s: Slice, mats: Mats, z: number): number {
  const mat = mats.get(layer === 'F.Cu' || layer === 'B.Cu' ? 'copper:outer' : 'copper:inner')
  const nets = new Map<string, { net?: string; rings: Ring[]; drills: Ring[] }>()
  const items: GlbItem[] = []
  for (const it of b.items ?? []) {
    if (!it.layers.includes(layer)) continue
    const key = it.net ?? ''
    let n = nets.get(key)
    if (!n) nets.set(key, (n = { ...(it.net ? { net: it.net } : {}), rings: [], drills: [] }))
    const rings = shapeOf(b, it.id)
    n.rings.push(...rings)
    if (it.drill && rings[1]) n.drills.push(rings[1])
    const own = outerLid(runJob({ kind: 'unit', key: '', rings: flatten(rings) }), layer === 'B.Cu' ? s.z0 : s.z1, layer === 'B.Cu' ? -1 : 1)
    if (own.length) items.push({ uid: it.uid ?? `id:${it.id}`, kind: it.kind, ...(it.net ? { net: it.net } : {}), accessor: g.accessor(toGlb(own), 'VEC3', undefined, true) })
  }
  const children: number[] = []
  for (const n of nets.values()) {
    const soup = new Soup()
    soup.job(mat, runJob({ kind: 'unit', key: '', rings: flatten(n.rings), merge: flatten(n.drills) }), s.z0, s.z1)
    const name = n.net ? `net:${n.net}` : 'netless'
    const mesh = g.mesh(`${layer} ${name}`, soup.prims())
    if (mesh !== null) children.push(g.node({ name, mesh, extras: extras('net', 0, { layer, ...(n.net ? { net: n.net } : {}) }) }))
  }
  return g.node({ name: `copper:${layer}`, children, extras: extras('copper', z, { layer, items }) })
}

/** The mask of a side: the slab with its openings, and the skin over the copper it covers, per net. */
function maskNode(g: Gltf, b: SiteData, side: Side, slices: Map<string, Slice>, mask: MaskInfo, mats: Mats, z: number): number {
  const t = mask.thickness[side]
  const cu = slices.get(`${side}.Cu`)!
  const soup = new Soup()
  soup.job(mats.get('mask'), runJob(slabJob(b, t, [], maskCuts(b, side, mask))), side === 'F' ? cu.z0 : cu.z1 - t)
  const nets = new Map<string, { rings: Ring[]; drills: Ring[] }>()
  for (const it of b.items ?? []) {
    if (!it.layers.includes(`${side}.Cu`)) continue
    const part = coveredOf(b, it.id, side)
    if (part && !part.length) continue
    const rings = shapeOf(b, it.id)
    const key = it.net ?? `#${it.id}`
    let n = nets.get(key)
    if (!n) nets.set(key, (n = { rings: [], drills: [] }))
    n.rings.push(...(part ?? rings))
    if (it.drill && rings[1]) n.drills.push(rings[1])
  }
  for (const n of nets.values())
    soup.job(mats.get('mask:copper'), runJob({ kind: 'skin', key: '', rings: flatten(n.rings), t, flare: MASK_FLARE, merge: flatten(n.drills) }), side === 'F' ? cu.z1 : cu.z0)
  const mesh = g.mesh(`${side}.Mask`, soup.prims())
  return g.node({ name: `${side}.Mask`, ...(mesh !== null ? { mesh } : {}), extras: extras('mask', z, { layer: `${side}.Mask` }) })
}

/** The silk of a side, every item unioned. */
function silk(g: Gltf, b: SiteData, side: Side, slices: Map<string, Slice>, mask: MaskInfo, mats: Mats, z: number): number {
  const layer = `${side}.SilkS`
  const s = sliceOf(layer, slices, mask.thickness)!
  const rings = (b.items ?? []).filter(it => it.layers.includes(layer)).flatMap(it => shapeOf(b, it.id))
  const soup = new Soup()
  if (rings.length) soup.job(mats.get('silk'), runJob({ kind: 'unit', key: '', rings: flatten(rings), merge: flatten([]) }), s.z0, s.z1)
  const mesh = g.mesh(layer, soup.prims())
  return g.node({ name: layer, ...(mesh !== null ? { mesh } : {}), extras: extras('silk', z, { layer }) })
}

/** The plating of every hole through the copper layers it joins. */
function barrels(g: Gltf, b: SiteData, slices: Map<string, Slice>, mats: Mats, z: number): number {
  const soup = new Soup()
  for (const it of b.items ?? []) {
    const cu = it.layers.filter(l => slices.has(l))
    const hole = it.drill && cu.length > 1 ? holeOf(shapeOf(b, it.id), it.drill) : null
    if (!hole) continue
    const z0 = Math.min(...cu.map(l => slices.get(l)!.z0)),
      z1 = Math.max(...cu.map(l => slices.get(l)!.z1))
    const t = tube(hole.slot ? hole.ring : circle(hole.c, it.drill! / 2), z0, z1)
    soup.add(mats.get('barrel'), t)
  }
  const mesh = g.mesh('barrels', soup.prims())
  return g.node({ name: 'barrels', ...(mesh !== null ? { mesh } : {}), extras: extras('barrels', z) })
}

/** The parts of a side, `part:<ref>` each: its model file's or generated body's meshes placed by a matrix, else the body box of a part without a model. */
function bodies(g: Gltf, b: SiteData, side: Side, slices: Map<string, Slice>, mats: Mats, inputs: GlbInputs, z: number): number {
  const face = bodyFace(slices, side)
  const shared = new Map<string, number | null>()
  const meshOf = (hash: string, model: StepModel, material: (c: Rgb) => number) => {
    if (!shared.has(hash)) shared.set(hash, g.mesh(`model:${hash.slice(0, 12)}`, modelPrims(model, material)))
    return shared.get(hash)!
  }
  const children = b.footprints
    .filter(fp => fp.side === side)
    .map(fp => {
      const node = { name: `part:${fp.ref}`, extras: extras('part', 0, { ref: fp.ref }) }
      const file = fp.step?.mesh ? inputs.mesh(fp.step.mesh) : null
      const made = !file && fp.mesh ? inputs.mesh(fp.mesh) : null
      const mesh = file ? meshOf(fp.step!.mesh!, file, mats.step) : made ? meshOf(fp.mesh!, made, mats.generated) : null
      if (mesh !== null) return g.node({ ...node, mesh, matrix: mul(C, file ? stepMatrix(fp, fp.step!.transform, face) : bodyMatrix(fp, face)) })
      const box = fp.mesh ? null : missingBox(g, fp, face, mats)
      return g.node({ ...node, ...(box !== null ? { mesh: box } : {}) })
    })
  return g.node({ name: `bodies:${side}`, children, extras: extras('bodies', z, { layer: `bodies:${side}` }) })
}

function modelPrims(model: StepModel, material: (c: Rgb) => number): Primitive[] {
  return model.meshes.filter(m => m.indices.length).map(m => ({ positions: m.positions, normals: m.normals, indices: m.indices, material: material(m.color) }))
}

/** A part without a model as its body box, none for `none` or a bare hole. */
function missingBox(g: Gltf, fp: SiteFootprint, face: number, mats: Mats): number | null {
  if (fp.model?.kind === 'none' || fp.height <= 0) return null
  const back = fp.side === 'B'
  const bx = box(fp.body.x, -fp.body.y, fp.body.rot, fp.body.w, fp.body.h, back ? face - fp.height : face, back ? face : face + fp.height)
  const soup = new Soup()
  soup.add(mats.get('body'), bx)
  return g.mesh(`body:${fp.ref}`, soup.prims())
}

/** A referenced board, `reference:<name>`, its mesh tinted and translucent as the viewer draws it, exploding with the parts of its side by `z`. */
function reference(g: Gltf, r: SiteReference, inputs: GlbInputs, z: number): number {
  const model = r.mesh ? inputs.reference(r.mesh) : null
  const tint = hex(r.color) ?? [0.5, 0.5, 0.5]
  const prims: Primitive[] = []
  for (const [i, m] of (model?.meshes ?? []).entries()) {
    if (!r.bodies && r.split !== undefined && i >= r.split) break
    if (!m.indices.length) continue
    const color = m.color.map((c, k) => c + (tint[k] - c) * 0.5) as Rgb
    prims.push({
      positions: m.positions,
      normals: m.normals,
      indices: m.indices,
      material: g.material({ name: `reference:${r.name}:${i}`, color, rough: 0.6, metal: 0.1, alpha: r.opacity }),
    })
  }
  const mesh = g.mesh(`reference:${r.name}`, prims)
  return g.node({
    name: `reference:${r.name}`,
    ...(mesh !== null ? { mesh } : {}),
    matrix: mul(C, r.transform),
    extras: extras('reference', z, { entry: r.entry, ...(r.side ? { side: r.side } : {}) }),
  })
}
