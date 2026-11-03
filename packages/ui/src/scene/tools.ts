// The 3D view's tool overlay: the rotation ring in the board plane, control points and leg handles, the grid in effect, the assist's dot
// field, start marker and preview trace as copper of its layer; drawn over the board, sized in screen pixels; board mm in, y flipped.
import * as THREE from 'three'
import type { ToolHit } from '../gesture'
import { RING_ALPHA, type RingShape } from '../ring'

type Pt = [number, number]
/** above the selection overlay and the DRC marks */
const ORDER = 9
/** screen pixels either side of the ring a press still takes it */
const RING_HIT = 6

export interface ToolColors {
  accent: string
  /** the handle's rim and the leg handle's fill */
  rim: string
  panel: string
  dim: string
  copper: string
}
export interface Trace {
  tracks: { layer: string; pts: Pt[] }[]
  vias: Pt[]
}

const flat = (color: string, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, side: THREE.DoubleSide })

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, at: Pt, z: number, data: Record<string, unknown> = {}): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat)
  m.position.set(at[0], -at[1], z)
  m.renderOrder = ORDER
  Object.assign(m.userData, { pick: false, ...data })
  return m
}

/** A handle: a filled disc with a rim, `r` and `w` in mm. */
function handle(at: Pt, z: number, r: number, w: number, fill: THREE.Material, rim: THREE.Material, data: Record<string, unknown>): THREE.Group {
  const g = new THREE.Group()
  g.add(mesh(new THREE.CircleGeometry(r + w, 32), rim, at, z, data))
  const c = mesh(new THREE.CircleGeometry(r, 32), fill, at, z, data)
  c.renderOrder = ORDER + 1
  g.add(c)
  return g
}

/** Round dots of a fixed screen size, `px` device pixels. */
function dotMaterial(color: string, px: number, opacity: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, size: { value: px }, opacity: { value: opacity } },
    vertexShader: 'uniform float size; void main() { gl_PointSize = size; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 color; uniform float opacity; void main() { if (length(gl_PointCoord - 0.5) > 0.5) discard; gl_FragColor = vec4(color, opacity); }',
    transparent: true,
    depthTest: false,
    depthWrite: false,
  })
}

/** Board points at height `z` as a position attribute, y flipped. */
export function positions(pts: readonly Pt[], z: number): Float32Array {
  const out = new Float32Array(pts.length * 3)
  pts.forEach((p, i) => out.set([p[0], -p[1], z], i * 3))
  return out
}
function cloud(pts: readonly Pt[], z: number, mat: THREE.Material): THREE.Points {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions(pts, z), 3))
  const p = new THREE.Points(geo, mat)
  p.renderOrder = ORDER
  p.userData.pick = false
  return p
}

/** A polyline of width `w` mm as triangles: a quad per segment and a disc at each point, so the joints are round. */
export function ribbon(pts: readonly Pt[], w: number, z: number): THREE.BufferGeometry {
  const v: number[] = []
  const h = w / 2
  const tri = (a: Pt, b: Pt, c: Pt) => v.push(a[0], -a[1], z, b[0], -b[1], z, c[0], -c[1], z)
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1],
      b = pts[i]
    const l = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (!l) continue
    const n: Pt = [(-(b[1] - a[1]) / l) * h, ((b[0] - a[0]) / l) * h]
    const a0: Pt = [a[0] + n[0], a[1] + n[1]],
      a1: Pt = [a[0] - n[0], a[1] - n[1]],
      b0: Pt = [b[0] + n[0], b[1] + n[1]],
      b1: Pt = [b[0] - n[0], b[1] - n[1]]
    tri(a0, a1, b1)
    tri(a0, b1, b0)
  }
  const SIDES = 16
  for (const p of pts)
    for (let k = 0; k < SIDES; k++) {
      const t0 = (k / SIDES) * 2 * Math.PI,
        t1 = ((k + 1) / SIDES) * 2 * Math.PI
      tri(p, [p[0] + h * Math.cos(t0), p[1] + h * Math.sin(t0)], [p[0] + h * Math.cos(t1), p[1] + h * Math.sin(t1)])
    }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3))
  return geo
}

/** Convex board polygons at height `z` as one geometry, y flipped, fanned from each first point. */
export function polygons(polys: readonly Pt[][], z: number): THREE.BufferGeometry {
  const v: number[] = []
  for (const p of polys) for (let i = 1; i < p.length - 1; i++) for (const q of [p[0], p[i], p[i + 1]]) v.push(q[0], -q[1], z)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3))
  return geo
}

function dispose(o: THREE.Object3D) {
  o.traverse(c => {
    const m = c as THREE.Mesh
    m.geometry?.dispose()
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : []
    for (const x of mats) x.dispose()
  })
}

export class ToolLayer {
  readonly root = new THREE.Group()
  private parts = new Map<string, THREE.Object3D>()

  constructor() {
    this.root.name = 'tools'
  }

  private put(name: string, o: THREE.Object3D | null) {
    const old = this.parts.get(name)
    if (old) {
      this.root.remove(old)
      dispose(old)
      this.parts.delete(name)
    }
    if (!o) return
    o.name = name
    this.parts.set(name, o)
    this.root.add(o)
  }

  /** The ring about the anchor's origin in the plane at `z`, as the 2D view draws it: the dark band, its ticks and the heading triangle; `px` mm per screen pixel. */
  ring(r: RingShape | null, z: number, px: number, c: ToolColors) {
    if (!r) return this.put('ring', null)
    const g = new THREE.Group()
    g.add(mesh(new THREE.RingGeometry(r.r - r.band / 2, r.r + r.band / 2, 192), flat('#000000', RING_ALPHA), r.c, z))
    const hit = new THREE.MeshBasicMaterial({ visible: false })
    const reach = Math.max(r.band / 2, RING_HIT * px)
    g.add(mesh(new THREE.RingGeometry(r.r - reach, r.r + reach, 64), hit, r.c, z, { tool: 'ring' }))
    for (const major of [false, true]) {
      const tick = mesh(
        polygons(
          r.ticks.filter(t => t.major === major).map(t => t.quad),
          z,
        ),
        flat(c.rim, major ? 0.95 : 0.6),
        [0, 0],
        0,
      )
      tick.renderOrder = ORDER + 1
      g.add(tick)
    }
    g.add(mesh(ribbon([[r.c[0] - px * 6, r.c[1]], [r.c[0] + px * 6, r.c[1]]], px, z), flat(c.accent), [0, 0], 0))
    g.add(mesh(ribbon([[r.c[0], r.c[1] - px * 6], [r.c[0], r.c[1] + px * 6]], px, z), flat(c.accent), [0, 0], 0))
    const tri = mesh(polygons([r.tri], z), flat(c.accent), [0, 0], 0, { tool: 'ring' })
    tri.renderOrder = ORDER + 2
    g.add(tri)
    this.put('ring', g)
  }

  /** Each control point `pt:k` and automatic leg handle `leg:k`, the picked point larger. */
  points(p: { pts: { k: number; at: Pt }[]; legs: { k: number; at: Pt }[] }, focus: number | null, z: number, px: number, c: ToolColors) {
    if (!p.pts.length && !p.legs.length) return this.put('points', null)
    const g = new THREE.Group()
    for (const l of p.legs) g.add(handle(l.at, z, 4 * px, 2 * px, flat(c.panel), flat(c.accent), { tool: 'leg', k: l.k }))
    for (const q of p.pts) g.add(handle(q.at, z, (focus === q.k ? 6 : 4) * px, 2 * px, flat(c.accent), flat(c.rim), { tool: 'pt', k: q.k }))
    this.put('points', g)
  }

  /** The grid in effect, segments x1 y1 x2 y2 in board mm. */
  grid(segs: readonly number[], z: number, color: string) {
    if (!segs.length) return this.put('grid', null)
    const v = new Float32Array((segs.length / 2) * 3)
    for (let i = 0; i < segs.length / 2; i++) v.set([segs[2 * i], -segs[2 * i + 1], z], i * 3)
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(v, 3))
    const l = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.16, depthTest: true, depthWrite: false }))
    l.renderOrder = -1
    l.userData.pick = false
    this.put('grid', l)
  }

  /** The anchor's grid dots through its origin by brightness bucket, as the assist draws its available dots. */
  gridDots(b: Pt[][], z: number, dpr: number, c: ToolColors) {
    if (!b.some(pts => pts.length)) return this.put('gridDots', null)
    const g = new THREE.Group()
    b.forEach((pts, i) => {
      if (!pts.length) return
      const material = dotMaterial(c.dim, 4.4 * dpr, .2 * (i + 1) / b.length)
      material.depthTest = true
      const dots = cloud(pts, z - .002, material)
      dots.renderOrder = -1
      g.add(dots)
    })
    this.put('gridDots', g)
  }

  /** The dot field by brightness bucket, the faint ones dimmer, the lit grid round the pointer smaller; `dpr` device pixels per CSS pixel. */
  dots(b: { ok: Pt[][]; off: Pt[][]; lit: Pt[][] }, z: number, dpr: number, c: ToolColors) {
    const n = b.ok.length
    if (!n && !b.lit.length) return this.put('dots', null)
    const g = new THREE.Group()
    const level = (i: number, of: number) => (i + 1) / of
    b.lit.forEach((pts, i) => pts.length && g.add(cloud(pts, z, dotMaterial(c.dim, 2.4 * dpr, level(i, b.lit.length) * 0.5))))
    b.off.forEach((pts, i) => pts.length && g.add(cloud(pts, z, dotMaterial(c.dim, 4.4 * dpr, level(i, n) * 0.4))))
    b.ok.forEach((pts, i) => pts.length && g.add(cloud(pts, z, dotMaterial(c.accent, 4.4 * dpr, level(i, n)))))
    this.put('dots', g)
  }

  /** The assist's start, a ring and a cross, and the hovered dot. */
  marks(start: Pt | null, hover: { at: Pt; ok: boolean } | null, z: number, px: number, c: ToolColors) {
    if (!start && !hover) return this.put('marks', null)
    const g = new THREE.Group()
    if (start) {
      g.add(mesh(new THREE.RingGeometry(8 * px, 9.5 * px, 48), flat(c.accent), start, z))
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
      ]) {
        const bar = new THREE.PlaneGeometry(dx ? 28 * px : 1.5 * px, dy ? 28 * px : 1.5 * px)
        g.add(mesh(bar, flat(c.accent, 0.8), start, z))
      }
    }
    if (hover) g.add(mesh(new THREE.RingGeometry(3.5 * px, 5 * px, 32), flat(hover.ok ? c.accent : c.dim), hover.at, z))
    this.put('marks', g)
  }

  /** The trace a pick would write, as copper of its layer at that layer's height, `w` mm wide, with its vias. */
  trace(t: Trace | null, zOf: (layer: string) => number, w: number, px: number, c: ToolColors) {
    if (!t) return this.put('trace', null)
    const g = new THREE.Group()
    const copper = flat(c.copper, 0.85)
    for (const k of t.tracks) {
      const z = zOf(k.layer)
      const m = new THREE.Mesh(ribbon(k.pts, w, z), copper.clone())
      m.renderOrder = ORDER
      m.userData.pick = false
      g.add(m)
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(k.pts.map(p => new THREE.Vector3(p[0], -p[1], z))),
        new THREE.LineDashedMaterial({ color: c.accent, dashSize: 4 * px, gapSize: 3 * px, depthTest: false, transparent: true }),
      )
      line.computeLineDistances()
      line.renderOrder = ORDER + 1
      line.userData.pick = false
      g.add(line)
    }
    for (const v of t.vias) g.add(handle(v, zOf('F.Cu'), 3 * px, 1.5 * px, flat(c.panel), flat(c.accent), {}))
    copper.dispose()
    this.put('trace', g)
  }

  /** The tool handle a ray meets first, a control point before the ring; null when none. */
  handleAt(ray: THREE.Raycaster): ToolHit | null {
    const hs = [this.parts.get('points'), this.parts.get('ring')].filter((o): o is THREE.Object3D => !!o)
    for (const o of hs) {
      const hit = ray.intersectObject(o, true).find(h => h.object.userData.tool)
      if (hit) return { tool: hit.object.userData.tool as string, k: hit.object.userData.k as number | undefined }
    }
    return null
  }

  clear() {
    for (const k of [...this.parts.keys()]) this.put(k, null)
  }
}
