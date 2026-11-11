// The board as a three.js scene: copper, slabs, mask, keepouts, part bodies and references in one group per layer, made from the
// board's facets, drawn as a Paint says, picked by a ray and exploded by a separation. Free of Vue and the DOM, so Node builds it.
// One three.js unit is a millimetre; board (x, y) is three (x, -y), z up, the slab from z = 0 to its thickness.
import * as THREE from 'three'
import type { SiteData, SiteFootprint } from '@pcbjs/core/site-data'
import type { SiteReference } from '@pcbjs/core/internal/reference'
import type { FacetName } from '@pcbjs/core/site-facets'
import { COLORS, FINISH, MASK_GAIN, MASK_OPACITY, sideColors } from '@pcbjs/export/internal/scene/colors'
import { copperIds, copperSlices, maskCuts, maskInfo, maskThickness, SILK, sliceOf, type MaskInfo, type Slice } from '@pcbjs/export/internal/scene/stack'
import { dielectrics, explodeGroup, offsets, stackOrder } from '@pcbjs/export/internal/scene/explode'
import { jobSize, runJob, slabJob, type GeoJob, type GeoResult } from '@pcbjs/export/internal/scene/geometry'
import { batches, buildItems, memberGeometry, memberMesh, raisedOf, type BuiltItems, type GeometryCache, type ItemInfo, type Member, type PieceInfo } from './items'
import { LayerBatch, type PieceState } from './batch'
import { Bodies } from './bodies'
import { toGeometry, type GeometryPool } from './geometry'
import { LOOK, STATES, Variants, setState, type HlState, type Look } from './highlight'
import { alone, isoOut, lit, own, type Keep } from './lit'
import { layerDimmed, slabState } from './focus'
import { hlStrength } from './intensity'
import { EASE_OUT, Tween } from './motion'
import { stackBox } from './fit'
import { bestHit } from './pick'
import { indexRaycast } from './ray-index'
import { boardIndex } from './index'
import { hull, type P2 } from './callouts'
import type { Ring } from './wire'
import type { OutlineState } from './outline'
import type { Lit, Paint } from '../paint'
import type { Stale } from '../live'
import type { Pose } from '../gesture'

export interface SceneOpts {
  /** a theme colour by its custom property */
  css(name: string, fallback: string): string
  cache: GeometryCache
  /** the geometry workers; null makes every geometry here, at once */
  pool: GeometryPool | null
  /** a part's model at its origin, front up; `track` takes what goes with this board */
  body(fp: SiteFootprint, b: SiteData, track: <T extends { dispose(): void }>(d: T) => T): THREE.Object3D
  /** a part's STEP model, placed on the board face at `face` mm */
  step?(fp: SiteFootprint, face: number, b: SiteData): Promise<THREE.Object3D | null>
  /** another entry's board shown as a reference */
  reference?(r: SiteReference, b: SiteData): Promise<THREE.Object3D | null>
  /** something drawn changed outside a call: geometry, a model or a reference landed */
  changed(): void
  /** every geometry of a build is in */
  meshed?(): void
  /** the models and references too */
  complete?(): void
}
/** What a ray picked: the item, a body as kind `body`, the layer group and the board point. */
export interface ScenePick {
  info: ItemInfo | null
  ref?: string
  group?: string
  at: [number, number]
}
/** A layer of the exploded stack named beside it. */
export interface Callout {
  group: string
  text: string
  title: string
  color: string
  /** the label's height in its group, mm */
  z: number
}
/** What a paint changed: nothing, the outlined sets only, or the scene. */
export type Painted = 'none' | 'outline' | 'scene'

const NO_IDS = new Set<number>(),
  NO_NAMES = new Set<string>()
const NO_STALE: Stale = { ids: NO_IDS, refs: NO_NAMES, nets: NO_NAMES, findings: NO_NAMES, gone: NO_IDS }
const NO_LIT: Lit = { ids: NO_IDS, parts: NO_NAMES, nets: NO_NAMES }
const REST: Paint = { hover: NO_LIT, sel: NO_LIT, anchor: NO_LIT, ctx: NO_LIT, fade: false, iso: null, stale: NO_STALE, hidden: NO_NAMES }
const PARTS = '#5b6270'
/** the weakest tint of a part body, as a fraction of the full one */
const BODY_MIN = 0.35
// more holes than this show a whole slab until the worker's cut one lands
const SYNC_HOLES = 120
// up to this many points the rest builds here at once, as one frame
const SYNC_POINTS = 20000
// not pickable: a click goes through to the copper under it
const KEEPOUT_DEPTH = 0.15
// a mesh of more triangles than this is tested through its grid
const INDEXED = 512

/** The union of lit sets, as one Keep. */
function keepOf(...ls: Lit[]): Keep {
  return { ids: new Set(ls.flatMap(l => [...l.ids])), parts: new Set(ls.flatMap(l => [...l.parts])), nets: new Set(ls.flatMap(l => [...l.nets])) }
}
const sameSet = <T>(a: ReadonlySet<T>, b: ReadonlySet<T>) => a === b || (a.size === b.size && [...a].every(x => b.has(x)))
const sameLit = (a: Lit, b: Lit) => a === b || (sameSet(a.ids, b.ids) && sameSet(a.parts, b.parts) && sameSet(a.nets, b.nets))
const both = <T>(a: Iterable<T>, b: Iterable<T>) => new Set([...a, ...b])

function safeColor(c: string | null): THREE.Color | null {
  if (!c || (typeof CSS !== 'undefined' && !CSS.supports('color', c))) return null
  try {
    return new THREE.Color(c)
  } catch {
    return null
  }
}
function maskShades(hex: string): { bare: THREE.Color; copper: THREE.Color } {
  const base = new THREE.Color(hex)
  const s = base.getHSL({ h: 0, s: 0, l: 0 }).s
  // mixed in sRGB, as the eye mixes the copper showing through, then lit back down to an albedo in linear
  const a = base.getRGB(new THREE.Color(), THREE.SRGBColorSpace),
    cu = new THREE.Color(COLORS.copper).getRGB(new THREE.Color(), THREE.SRGBColorSpace)
  const k = 0.08 + 0.16 * s
  const copper = new THREE.Color().setRGB(a.r + (cu.r - a.r) * k, a.g + (cu.g - a.g) * k, a.b + (cu.b - a.b) * k, THREE.SRGBColorSpace).offsetHSL(0, 0, 0.03 + 0.03 * s)
  return { bare: base.clone().multiplyScalar(1 / MASK_GAIN), copper: copper.multiplyScalar(1 / MASK_GAIN) }
}
/** A subtree whose objects move only when the scene moves them: each matrix made now, so a frame's scene walk composes nothing; a matrix set by hand is kept. */
export function freeze<T extends THREE.Object3D>(root: T): T {
  root.traverse(o => {
    if (!o.matrixAutoUpdate) return
    o.updateMatrix()
    o.matrixAutoUpdate = false
  })
  return root
}

type Mats = {
  outer: THREE.MeshStandardMaterial
  inner: THREE.MeshStandardMaterial
  silk: Record<'F' | 'B', THREE.MeshStandardMaterial>
  barrel: THREE.MeshStandardMaterial
  slab: THREE.MeshStandardMaterial[]
  mask: Record<'F' | 'B', Record<'bare' | 'copper', THREE.MeshPhysicalMaterial>>
}
/** What one paint pass draws with: the fade's keep set and the states the ramps still hold. */
interface Pass {
  p: Paint
  kept: Keep
  focus: boolean
  netRefs: Set<string>
  keep(was: PieceState | undefined, st: PieceState): PieceState
}
/** An item drawn over its merged copper, and the state it is drawn in. */
type OverInfo = Member['info'] & { st: HlState | null }
const isMaskGroup = (name: string) => /\.Mask$/.test(name)

export class BoardScene {
  /** the board, its matrix the shown frame */
  readonly root = new THREE.Group()
  /** a pose's pads and items drawn again where it goes */
  readonly ghosts = new THREE.Group()
  groups = new Map<string, THREE.Group>()
  slices = new Map<string, Slice>()
  order: string[] = []
  /** the outline's hull in three's x and y, the callouts' anchors, and its rings for the planes' wireframes */
  hull: P2[] = []
  rings: Ring[] = []
  callouts: Callout[] = []
  /** the exploded planes drawn as wireframes: the silk and parts of each side */
  planes: { group: string; z: number; color: string }[] = []
  /** the outlined sets of the current paint */
  outlines: Record<OutlineState, THREE.Mesh[]> = { ctx: [], hover: [], sel: [], anchor: [] }
  /** a build counter: work of an older build checks it and stops */
  gen = 0
  meshed = false
  complete = false
  readonly stats = { buildMs: 0, buildStart: 0, geometryMs: 0, completeAt: 0, landings: [] as [number, number, string, number][] }
  private b: SiteData | null = null
  private opts: SceneOpts
  private mats: Mats | null = null
  private mask: MaskInfo | null = null
  private built: BuiltItems | null = null
  private bodies: THREE.Object3D[] = []
  /** each part's model meshes, drawn by the body batches, copied by an outline */
  private bodyMeshes = new Map<string, THREE.Mesh[]>()
  private parts = new Bodies()
  /** the items drawn over their merged copper now, a batch per layer, and what they are */
  private over: LayerBatch<OverInfo>[] = []
  private overSig = ''
  private refsByNet = new Map<string, string[]>()
  private slabs: THREE.Mesh[] = []
  private masks: THREE.Mesh[] = []
  private marks = new Map<string, number>()
  private disposables: { dispose(): void }[] = []
  private bodyDisposables: { dispose(): void }[] = []
  private inflight = new Map<string, Promise<GeoResult>>()
  private variants: Variants
  private levels = new Map<HlState, Tween>(STATES.map(st => [st, new Tween(1, EASE_OUT, st === 'rim' ? 120 : 160)]))
  private p: Paint = REST
  private layer: string | null = null
  private look: Look = LOOK
  private ends: readonly number[] = []
  private wasFocus = false
  private wasSee = false
  private wasRim = ''
  private see = new Set<THREE.Object3D>()
  private seeList: THREE.Object3D[] | null = null
  private pickable: THREE.Mesh[] | null = null
  private warmList: THREE.Mesh[] = []
  private sep = -1
  private frame = new THREE.Matrix4()
  private ray = new THREE.Raycaster()
  private poseIds = new Set<number>()
  private ghostKey = ''
  private ghostBoard: SiteData | null = null
  private posed: THREE.Object3D[] = []
  private disposed = false

  constructor(opts: SceneOpts) {
    this.opts = opts
    this.variants = new Variants(opts.css)
    this.root.matrixAutoUpdate = false
    this.ghosts.matrixAutoUpdate = false
  }

  /** The board data now; `changed` names its facets that differ from the last: new shapes or outline remake the board, new footprints the bodies. */
  setFacets(b: SiteData, changed: ReadonlySet<FacetName>): { refs: Promise<void> | null } | null {
    const was = this.b
    this.b = b
    if (!was || changed.has('shapes') || b.outline !== was.outline) return this.build(b)
    if ((changed.has('meta') || changed.has('model')) && b.footprints !== was.footprints) {
      this.placeBodies(b)
      this.repaint()
    }
    return null
  }

  get board(): SiteData | null {
    return this.b
  }
  /** the pieces the batches draw */
  get meshes(): number {
    return this.built?.batches.reduce((n, b) => n + b.size, 0) ?? 0
  }
  /** The top copper's colour, for the tools drawn over it. */
  get copper(): string {
    return this.mats ? `#${this.mats.outer.color.getHexString()}` : COLORS.copper
  }
  /** What the outline's depth pass leaves out: what is faded or see-through. */
  get seeThrough(): readonly THREE.Object3D[] {
    return (this.seeList ??= [...this.see, ...[...this.root.children].filter(c => c.name === 'References')])
  }

  private track<T extends { dispose(): void }>(d: T): T {
    this.disposables.push(d)
    return d
  }
  private group(name: string): THREE.Group {
    let g = this.groups.get(name)
    if (!g) {
      g = new THREE.Group()
      g.name = name
      this.groups.set(name, g)
      this.root.add(g)
    }
    return g
  }

  private build(b: SiteData): { refs: Promise<void> | null } {
    const t0 = performance.now()
    this.clear()
    const my = ++this.gen
    this.meshed = this.complete = false
    this.sep = -1
    this.ghostKey = ''
    const queue: GeoJob[] = []
    this.slices = copperSlices(b)
    this.makeMaterials(b)
    this.order = stackOrder(b)
    for (const name of this.order) this.group(name)
    const mask = (this.mask = maskInfo(b, { F: maskThickness(b, 'F'), B: maskThickness(b, 'B') }))
    const mats = this.mats!
    this.built = buildItems(
      b,
      this.slices,
      mask,
      { copper: l => (l === 'F.Cu' || l === 'B.Cu' ? mats.outer : mats.inner), silk: s => mats.silk[s], barrel: mats.barrel, mask: s => mats.mask[s].copper },
      this.opts.cache,
      n => this.group(n),
    )
    this.buildKeepouts(b)
    const diel = dielectrics(b, this.slices)
    for (const d of diel) this.group(d.name).add(this.slabSlice(b, d.z0, d.z1, queue))
    this.group('F.Mask').add(this.maskSlab(b, 'F', mask, queue))
    this.group('B.Mask').add(this.maskSlab(b, 'B', mask, queue))
    const loads = this.placeBodies(b)
    this.marks = this.markHeights(b, mask)
    const refs = this.placeReferences(b, my)
    if (refs) loads.push(refs)
    this.outlineOf(b)
    this.calloutsOf(b, diel, mask)
    // the board group keeps the frame matrix; what is under it moves only when the scene moves it
    for (const c of this.root.children) freeze(c)
    this.repaint()
    this.stats.buildMs = performance.now() - t0
    this.stats.buildStart = t0
    this.landed([Math.round(t0), 0, 'build', Math.round(this.stats.buildMs)])
    this.stats.geometryMs = 0
    this.rest(my, queue, loads)
    return { refs }
  }

  private clear() {
    this.poseIds.clear()
    for (const bt of this.built?.batches ?? []) bt.dispose()
    this.built?.barrels?.dispose()
    this.parts.dispose()
    this.over = []
    this.overSig = ''
    for (const c of [...this.root.children]) this.root.remove(c)
    for (const d of [...this.disposables, ...this.bodyDisposables]) d.dispose()
    this.disposables = []
    this.bodyDisposables = []
    this.variants.dispose()
    this.groups = new Map()
    this.slabs = []
    this.masks = []
    this.bodies = []
    this.bodyMeshes = new Map()
    this.built = null
    this.pickable = null
    this.see.clear()
    this.seeList = null
    this.ghosts.clear()
    this.outlines = { ctx: [], hover: [], sel: [], anchor: [] }
  }

  private makeMaterials(b: SiteData) {
    const finish = FINISH[b.stackup?.finish ?? ''] ?? FINISH.HASL
    const std = (p: THREE.MeshStandardMaterialParameters) => this.track(new THREE.MeshStandardMaterial(p))
    // low specular, thin sharp clearcoat: a broad specular lobe under these lights washes the colour out to grey
    const mask = () => {
      const shades = maskShades(this.maskColor(b))
      const one = (color: THREE.Color) =>
        this.track(
          new THREE.MeshPhysicalMaterial({
            color,
            roughness: 0.55,
            metalness: 0,
            specularIntensity: 0.15,
            clearcoat: 0.2,
            clearcoatRoughness: 0.1,
            envMapIntensity: 0.1,
            transparent: true,
            opacity: MASK_OPACITY,
            // Real mask thickness separates the surfaces; depth bias can pull the mask in front of silk.
            depthWrite: false,
          }),
        )
      return { bare: one(shades.bare), copper: one(shades.copper) }
    }
    const silk = this.silkColor(b)
    // A small depth-unit bias keeps mask rounding from tinting silk without a slope-dependent displacement.
    const ink = () => std({ color: silk, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: -4 })
    this.mats = {
      outer: std({ color: finish, roughness: 0.32, metalness: 0.75 }),
      inner: std({ color: COLORS.copper, roughness: 0.4, metalness: 0.6 }),
      silk: { F: ink(), B: ink() },
      barrel: std({ color: finish, roughness: 0.35, metalness: 0.7, side: THREE.DoubleSide }),
      slab: [std({ color: COLORS.fr4, roughness: 0.7 }), std({ color: COLORS.edge, roughness: 0.85 })],
      mask: { F: mask(), B: mask() },
    }
  }
  maskColor(b: SiteData): string {
    const c = safeColor(sideColors(b.stackup).mask)
    return c ? `#${c.getHexString()}` : COLORS.mask
  }
  private silkColor(b: SiteData): string {
    const c = safeColor(sideColors(b.stackup).silk)
    return c ? `#${c.getHexString()}` : COLORS.silk
  }

  /** From the cache, cut here with few holes, else whole now with the cut job queued for the worker. */
  private slabMesh(job: Extract<GeoJob, { kind: 'slab' }>, holes: number, mat: THREE.Material | THREE.Material[], queue: GeoJob[]): THREE.Mesh {
    const cache = this.opts.cache
    let geo = cache.get(job.key)
    if (geo === undefined) {
      if (holes <= SYNC_HOLES || !this.opts.pool) {
        geo = toGeometry(runJob(job))
        cache.put(job.key, geo)
      } else {
        const whole = { ...job, key: `${job.key}:whole`, drills: new Float64Array(0), openings: undefined, outline: { xy: job.outline.xy, len: job.outline.len.subarray(0, 1) } }
        geo = cache.get(whole.key)
        if (geo === undefined) {
          geo = toGeometry(runJob(whole))
          cache.put(whole.key, geo)
        }
        queue.push(job)
      }
    }
    const m = new THREE.Mesh(geo ?? new THREE.BufferGeometry(), mat)
    m.userData.slabKey = job.key
    return m
  }
  private slabSlice(b: SiteData, z0: number, z1: number, queue: GeoJob[]): THREE.Mesh {
    // lids in group 0, sides in group 1
    const m = this.slabMesh(slabJob(b, z1 - z0, b.drills, []), b.drills.length + b.outline.length, this.mats!.slab, queue)
    m.position.z = z0
    m.userData.pick = 'slab'
    m.userData.base = m.material
    this.slabs.push(m)
    return m
  }
  // NPTH holes go through the mask too, unless an opening already clears them
  private maskSlab(b: SiteData, side: 'F' | 'B', mask: MaskInfo, queue: GeoJob[]): THREE.Mesh {
    const cuts = maskCuts(b, side, mask)
    const t = mask.thickness[side]
    const m = this.slabMesh(slabJob(b, t, [], cuts), cuts.length, this.mats!.mask[side].bare, queue)
    m.position.z = side === 'F' ? this.slices.get('F.Cu')!.z0 : this.slices.get('B.Cu')!.z1 - t
    m.userData.pick = false
    m.userData.base = m.material
    this.masks.push(m)
    return m
  }

  private buildKeepouts(b: SiteData) {
    if (!b.keepouts?.length) return
    const rail = new Map(b.layers.map(l => [l.id, l.color]))
    const kmats = new Map<string, { fill: THREE.Material; line: THREE.LineBasicMaterial }>()
    const matOf = (layer: string) => {
      let m = kmats.get(layer)
      if (!m) {
        const c = safeColor(rail.get(layer) ?? null) ?? new THREE.Color('#9aa0aa')
        // halfway to grey, so a keepout reads as an area and not as copper
        c.lerp(new THREE.Color('#8a8f98'), 0.5)
        m = {
          fill: this.track(new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide })),
          line: this.track(new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: 0.9 })),
        }
        kmats.set(layer, m)
      }
      return m
    }
    for (const k of b.keepouts) {
      const shapes = k.outline.filter(r => r.length > 2).map(r => new THREE.Shape(r.map(([x, y]) => new THREE.Vector2(x, -y))))
      if (!shapes.length) continue
      const geo = this.track(new THREE.ExtrudeGeometry(shapes, { depth: KEEPOUT_DEPTH, bevelEnabled: false, curveSegments: 1 }))
      const edges = this.track(new THREE.EdgesGeometry(geo, 30))
      for (const layer of k.layers) {
        const s = this.slices.get(layer)
        if (!s) continue
        const mat = matOf(layer)
        // outer layers stand out of the board through the mask, inner ones sit centred on their copper
        const z = layer === 'F.Cu' ? s.z0 : layer === 'B.Cu' ? s.z1 - KEEPOUT_DEPTH : (s.z0 + s.z1) / 2 - KEEPOUT_DEPTH / 2
        const m = new THREE.Mesh(geo, mat.fill)
        m.position.z = z
        m.renderOrder = 3
        m.userData.pick = false
        m.userData.keepout = true
        const e = new THREE.LineSegments(edges, mat.line)
        e.position.z = z
        e.userData.pick = false
        this.group(layer).add(m, e)
      }
    }
  }

  /** Every part's body in its side's group; returns the STEP models' loads. */
  private placeBodies(b: SiteData): Promise<void>[] {
    for (const o of this.bodies) o.parent?.remove(o)
    for (const d of this.bodyDisposables) d.dispose()
    this.bodyDisposables = []
    this.bodyMeshes = new Map()
    this.refsByNet = new Map()
    for (const fp of b.footprints)
      for (const p of fp.pads)
        if (p.net) {
          const l = this.refsByNet.get(p.net)
          if (!l) this.refsByNet.set(p.net, [fp.ref])
          else if (l.at(-1) !== fp.ref) l.push(fp.ref)
        }
    const loads: Promise<void>[] = []
    this.bodies = b.footprints.map(fp => this.placeBody(fp, b, loads))
    for (const [i, o] of this.bodies.entries()) this.group(b.footprints[i].side === 'B' ? 'bodies:B' : 'bodies:F').add(freeze(o))
    this.batchBodies()
    this.pickable = null
    this.ghostKey = ''
    return loads
  }

  /** Every part's model meshes into the body batches and instances. */
  private batchBodies() {
    this.parts.build(this.bodies.map(root => ({ ref: root.userData.ref, root, meshes: this.bodyMeshes.get(root.userData.ref) ?? [] })))
  }

  // back parts turn over about the model's y axis: the footprint mirrored in x, printed side readable from below
  private placeBody(fp: SiteFootprint, b: SiteData, loads: Promise<void>[]): THREE.Group {
    const { body } = fp
    const back = fp.side === 'B'
    const model = this.opts.body(fp, b, d => {
      this.bodyDisposables.push(d)
      return d
    })
    const wrap = new THREE.Group()
    wrap.userData.ref = fp.ref
    const g = new THREE.Group()
    wrap.add(g)
    const face = back ? this.slices.get('B.Cu')!.z0 : this.slices.get('F.Cu')!.z1
    g.position.set(body.x, -body.y, face)
    g.rotation.z = (body.rot * Math.PI) / 180
    if (back) {
      const flip = new THREE.Group()
      flip.rotation.y = Math.PI
      flip.add(model)
      g.add(flip)
    } else g.add(model)
    // a big body tints less, never below BODY_MIN; no outline on a model's many edges
    const strength = hlStrength(body.w * body.h, BODY_MIN)
    const meshesOf = (o: THREE.Object3D) => {
      const out: THREE.Mesh[] = []
      o.traverse(m => {
        if ((m as THREE.Mesh).isMesh) {
          m.userData.strength = strength
          m.userData.noOutline = true
          out.push(m as THREE.Mesh)
        }
      })
      return out
    }
    this.bodyMeshes.set(fp.ref, meshesOf(g))
    const step = fp.step && this.opts.step?.(fp, face, b)
    if (step) {
      const my = this.gen
      loads.push(
        step.then(m => {
          if (!m || my !== this.gen || this.disposed || !this.bodies.includes(wrap)) return
          wrap.remove(g)
          wrap.add(freeze(m))
          this.bodyMeshes.set(fp.ref, meshesOf(m))
          this.batchBodies()
          this.repaint()
          this.opts.changed()
        }),
      )
    }
    return wrap
  }

  /** The references, each exploding with the side it mates on; resolves once all have landed. */
  private placeReferences(b: SiteData, my: number): Promise<void> | null {
    const load = this.opts.reference
    const refs = (b.references ?? []).filter(r => r.mesh)
    if (!load || !refs.length) return null
    return Promise.all(
      refs.map(r =>
        load(r, b).then(o => {
          if (!o || my !== this.gen || this.disposed) return
          // a stacked board explodes with the parts of the side it mates on, the gap to its local part kept
          const holder = new THREE.Group()
          holder.name = o.name
          holder.userData.explode = explodeGroup(r.side)
          holder.position.z = offsets(this.order, Math.max(0, this.sep)).get(holder.userData.explode) ?? 0
          holder.add(o)
          const g = this.group('References')
          g.userData.split = true
          g.add(freeze(holder))
          this.seeList = null
          this.pickable = null
          this.opts.changed()
        }),
      ),
    ).then(() => {})
  }

  /** The geometries the build left to make: here at once when small or with no workers, else in the workers, each landing as it comes. */
  private rest(my: number, slabs: GeoJob[], loads: Promise<void>[]) {
    const items = this.built!
    const jobs = [...items.jobs, ...slabs]
    const done = () => {
      if (my !== this.gen) return
      this.meshed = true
      this.pickable = null
      this.warmList = this.pickList().filter(m => m.userData.warmIndex)
      this.opts.meshed?.()
      this.opts.changed()
      if (loads.length) Promise.all(loads).then(finish)
      else finish()
    }
    const finish = () => {
      if (my !== this.gen || this.disposed) return
      this.complete = true
      this.opts.cache.sweep()
      this.stats.geometryMs = performance.now() - this.stats.buildStart
      this.stats.completeAt ||= performance.now()
      this.opts.complete?.()
      this.opts.changed()
    }
    const land = (results: GeoResult[]) => {
      if (this.disposed) return
      const t = performance.now()
      if (my === this.gen) this.land(results)
      this.landed([Math.round(t - this.stats.buildStart), results.length, results[0]?.key.split(':')[0] ?? '', Math.round(performance.now() - t)])
    }
    const pool = this.opts.pool
    if (!jobs.length) return done()
    if (!pool || jobs.reduce((n, j) => n + jobSize(j), 0) <= SYNC_POINTS) {
      land(jobs.map(runJob))
      return done()
    }
    // a job another build already sent is not sent again: this build waits for the same result
    const waits: Promise<void>[] = []
    const fresh = jobs.filter(j => {
      const p = this.inflight.get(j.key)
      if (p) waits.push(p.then(r => land([r])))
      return !p
    })
    for (const batch of batches(fresh)) {
      const sent = pool.run(batch)
      batch.forEach((j, i) => {
        const p = sent.then(r => r[i])
        this.inflight.set(j.key, p)
        p.then(() => this.inflight.delete(j.key))
      })
      waits.push(sent.then(land))
    }
    Promise.all(waits).then(done)
  }

  // the dev stats keep the last 200
  private landed(l: [number, number, string, number]) {
    const all = this.stats.landings
    all.push(l)
    if (all.length > 200) all.shift()
  }

  /** Geometry results in: the pieces they bring laid into their batches, painted as the board is, and the slabs' cut geometry swapped in. */
  private land(results: GeoResult[]) {
    const items = this.built!
    const added = items.fill(results)
    let swapped = 0
    for (const r of results) {
      if (!r.key.startsWith('slab:')) continue
      const geo = this.opts.cache.get(r.key)
      if (geo)
        for (const m of [...this.slabs, ...this.masks])
          if (m.userData.slabKey === r.key) {
            m.geometry = geo
            swapped++
          }
    }
    if (!added && !swapped) return
    if (added) {
      for (const bt of items.batches) bt.flush()
      this.repaint()
    }
    this.opts.changed()
  }
  /** The height of each layer's annotations: above a front layer, under a back one, mid way through an inner one. */
  private markHeights(b: SiteData, mask: MaskInfo): Map<string, number> {
    const out = new Map<string, number>()
    const f = this.slices.get('F.Cu')!,
      bk = this.slices.get('B.Cu')!
    for (const id of copperIds(b.copper)) {
      const s = this.slices.get(id)!
      out.set(id, id === 'F.Cu' ? s.z1 : id === 'B.Cu' ? s.z0 : (s.z0 + s.z1) / 2)
    }
    out.set('F.Mask', f.z1 + mask.thickness.F)
    out.set('B.Mask', bk.z0 - mask.thickness.B)
    for (const side of ['F', 'B'] as const) {
      const s = sliceOf(`${side}.SilkS`, this.slices, mask.thickness)
      if (s) out.set(`${side}.SilkS`, side === 'F' ? s.z1 : s.z0)
    }
    return out
  }
  /** Whether a layer has an annotation height of its own. */
  marked(layer: string): boolean {
    return this.marks.has(layer)
  }
  /** A layer's annotation height in the board group, its explode offset included. */
  markZ(layer: string): number {
    return (this.marks.get(layer) ?? 0) + (this.groups.get(layer)?.position.z ?? 0)
  }
  /** The height of a copper layer's face, its explode offset included: the top of the front, the bottom of the back. */
  faceZ(layer: string): number {
    const s = this.slices.get(layer)
    const off = offsets(this.order, Math.max(0, this.sep)).get(layer) ?? 0
    if (!s) return (this.b?.thickness ?? 0) + off
    return (layer === 'B.Cu' ? s.z0 : layer === 'F.Cu' ? s.z1 : (s.z0 + s.z1) / 2) + off
  }

  private outlineOf(b: SiteData) {
    const bb = b.bbox
    const pts: P2[] = b.outline.length
      ? b.outline.flat().map(([x, y]) => [x, -y])
      : [
          [bb.x, -bb.y],
          [bb.x + bb.w, -bb.y],
          [bb.x + bb.w, -bb.y - bb.h],
          [bb.x, -bb.y - bb.h],
        ]
    this.hull = hull(pts)
    this.rings = b.outline.length ? b.outline.map(r => r.map(([x, y]) => [x, -y] as const)) : [pts]
  }

  /** A callout per layer of the stack, and the planes drawn as wireframes when exploded. */
  private calloutsOf(b: SiteData, diel: ReturnType<typeof dielectrics>, mask: MaskInfo) {
    const rail = new Map(b.layers.map(l => [l.id, l]))
    const silkT = (side: 'F' | 'B') => {
      const l = b.stackup?.layers.find(s => s.type === 'silk' && s.side === side) as { thickness?: number } | undefined
      return l?.thickness ?? SILK
    }
    const mm = (v: number) => `${+v.toFixed(3)} mm`
    const railOf = (id: string, fallback: string) => rail.get(id)?.color ?? fallback
    const out: Callout[] = [],
      planes: { group: string; z: number; color: string }[] = []
    const add = (group: string, text: string, title: string, color: string, z: number) => out.push({ group, text, title, color, z })
    for (const id of copperIds(b.copper)) {
      const s = this.slices.get(id)!
      add(id, id, `${id}, ${rail.get(id)?.name ?? 'copper'}, ${mm(s.z1 - s.z0)}`, railOf(id, '#c87533'), (s.z0 + s.z1) / 2)
    }
    for (const d of diel) add(d.name, d.kind, `${d.label}`, COLORS.fr4, (d.z0 + d.z1) / 2)
    const maskC = this.maskColor(b)
    for (const side of ['F', 'B'] as const) {
      const cu = this.slices.get(`${side}.Cu`)!,
        t = mask.thickness[side]
      add(
        `${side}.Mask`,
        `${side}.Mask`,
        `${side}.Mask, ${rail.get(`${side}.Mask`)?.name ?? 'solder mask'}, ${mm(t)}, ${maskC}`,
        maskC,
        side === 'F' ? cu.z1 + t / 2 : cu.z0 - t / 2,
      )
      const s = sliceOf(`${side}.SilkS`, this.slices, mask.thickness)!
      const silk = railOf(`${side}.SilkS`, '#d0d0d0')
      add(`${side}.SilkS`, `${side}.SilkS`, `${side}.SilkS, ${rail.get(`${side}.SilkS`)?.name ?? 'silkscreen'}, ${mm(silkT(side))}`, silk, (s.z0 + s.z1) / 2)
      planes.push({ group: `${side}.SilkS`, z: side === 'F' ? s.z0 : s.z1, color: silk })
      const n = b.footprints.filter(f => f.side === side).length
      if (!n) continue
      add(`bodies:${side}`, 'parts', `${n} ${side === 'F' ? 'front' : 'back'} part${n === 1 ? '' : 's'}`, PARTS, side === 'F' ? cu.z1 + 0.6 : cu.z0 - 0.6)
      planes.push({ group: `bodies:${side}`, z: side === 'F' ? cu.z1 + t : cu.z0 - t, color: PARTS })
    }
    for (const p of planes) this.group(p.group)
    this.callouts = out
    this.planes = planes
  }

  /** The stack at a separation, mm between layers; false when it is there already. */
  explode(sep: number): boolean {
    if (sep === this.sep) return false
    this.sep = sep
    const off = offsets(this.order, sep)
    for (const [name, g] of this.groups) {
      g.position.z = off.get(name) ?? 0
      g.updateMatrix()
    }
    for (const h of this.groups.get('References')?.children ?? []) {
      h.position.z = off.get(h.userData.explode) ?? 0
      h.updateMatrix()
    }
    // the plating stretches from the bottom copper to the top copper, so the holes stay aligned
    const barrels = this.groups.get('barrels')
    if (barrels) {
      const zb = this.slices.get('B.Cu')!.z0,
        zt = this.slices.get('F.Cu')!.z1
      const oB = off.get('B.Cu') ?? 0,
        oF = off.get('F.Cu') ?? 0
      const s = (zt - zb + oF - oB) / (zt - zb)
      barrels.scale.z = s
      barrels.position.z = zb + oB - zb * s
      barrels.updateMatrix()
    }
    return true
  }
  /** The explode offset of a group at the current separation. */
  offset(group: string): number {
    return offsets(this.order, Math.max(0, this.sep)).get(group) ?? 0
  }

  /** The board, its parts and references at a separation; never the grid. */
  bounds(sep: number): THREE.Box3 {
    const box = stackBox(this.root, offsets(this.order, sep))
    if (!box.isEmpty() || !this.b) return box
    const bb = this.b.bbox
    return new THREE.Box3(new THREE.Vector3(bb.x, -(bb.y + bb.h), 0), new THREE.Vector3(bb.x + bb.w, -bb.y, this.b.thickness))
  }

  /** The shown frame: the board, and a drag's pads, through this matrix. */
  setFrame(m: THREE.Matrix4) {
    this.frame.copy(m)
    this.root.matrix.copy(m)
    this.root.matrixWorldNeedsUpdate = true
    this.ghostKey = ''
  }

  /** The layer group a mesh sits in, the child of the board group above it. */
  groupOf(m: THREE.Object3D): string | undefined {
    if (m.userData.group !== undefined) return m.userData.group
    let o: THREE.Object3D | null = m
    while (o && o.parent !== this.root) o = o.parent
    return (m.userData.group = o?.name)
  }
  private isMask(m: THREE.Mesh) {
    return /\.Mask$/.test(this.groupOf(m) ?? '')
  }

  // ---- paint ----

  /** A hovered layer of the exploded stack: every other one turns see-through. */
  hoverLayer(name: string | null) {
    if (this.layer === name) return
    this.layer = name
    this.repaint()
  }
  /** How the content out of a focus is drawn. */
  setLook(look: Look) {
    this.look = { ...look }
    this.repaint()
  }
  /** The candidates of a route end slot, outlined as members. */
  setEnds(ids: readonly number[]) {
    this.ends = ids
    this.outline()
  }
  /** New theme colours: every variant made again. */
  theme() {
    this.variants.dispose()
    this.repaint()
  }

  /** Draw a paint: a hover changes only the outlined sets; anything else paints the batches and instances again, a pass over their pieces that makes an index only for a draw whose pieces changed. */
  paint(p: Paint, prev: Paint | null): Painted {
    this.p = p
    const same =
      !!prev &&
      p.fade === prev.fade &&
      p.iso === prev.iso &&
      p.stale === prev.stale &&
      sameSet(p.hidden, prev.hidden) &&
      sameLit(p.sel, prev.sel) &&
      sameLit(p.anchor, prev.anchor) &&
      sameLit(p.ctx, prev.ctx)
    if (!same) {
      this.repaint()
      return 'scene'
    }
    if (sameLit(p.hover, prev!.hover)) return 'none'
    this.outline()
    return 'outline'
  }

  /** Everything painted again as the current paint says. */
  repaint() {
    if (!this.built) return
    this.pickable = null
    this.visibility()
    const pass = this.pass()
    this.see.clear()
    this.seeList = null
    this.paintItems(pass)
    this.paintBodies(pass)
    this.paintSlabs(pass)
    this.rim(pass)
    this.overlay(pass)
    this.outline()
  }

  private visibility() {
    const hid = this.p.hidden
    for (const [name, g] of this.groups) {
      if (/\.(Cu|SilkS|Mask)$/.test(name) || name === 'References') g.visible = !hid.has(name)
    }
    const barrels = this.groups.get('barrels')
    if (barrels && this.b) barrels.visible = copperIds(this.b.copper).some(id => !hid.has(id))
  }
  // inner copper inside an opaque slab is invisible: the slab turns see-through while an inner layer is shown and an outer one hidden
  private innerShown(): boolean {
    if (!this.b) return false
    const hid = this.p.hidden,
      cu = copperIds(this.b.copper)
    return cu.length > 2 && cu.slice(1, -1).some(id => !hid.has(id)) && (hid.has('F.Cu') || hid.has('B.Cu'))
  }

  /** The keep set and the ramps of the current paint; the fade, dim and see ramps start or turn as it begins or ends. */
  private pass(): Pass {
    const p = this.p,
      v = this.variants
    const kept = keepOf(p.sel, p.anchor, p.ctx)
    const focus = p.fade
    const fade = this.levels.get('fade')!,
      dim = this.levels.get('dim')!,
      seeT = this.levels.get('see')!
    const now = performance.now()
    // a faded isolation fades as a focus does
    const faded = focus || !!p.iso?.fade
    if (faded && !this.wasFocus) {
      fade.snap(0)
      dim.snap(0)
    }
    fade.set(faded ? 1 : 0, now)
    dim.set(focus ? 1 : 0, now)
    this.wasFocus = faded
    const see = !!this.layer || p.stale.ids.size > 0 || p.stale.refs.size > 0
    if (see && !this.wasSee) seeT.snap(0)
    seeT.set(see ? 1 : 0, now)
    this.wasSee = see
    const fading = !faded && fade.value > 0,
      clearing = !see && seeT.value > 0
    v.setLook(faded || (fading && !this.innerShown()) ? this.look : null)
    const netRefs = new Set<string>()
    for (const n of kept.nets) for (const r of this.refsByNet.get(n) ?? []) netRefs.add(r)
    const keep = (was: PieceState | undefined, st: PieceState): PieceState =>
      st === null && ((fading && (was === 'fade' || was === 'dim')) || (clearing && was === 'see')) ? was : st
    return { p, kept, focus, netRefs, keep }
  }

  private seen(m: THREE.Object3D, on: boolean) {
    if (on === this.see.has(m)) return
    if (on) this.see.add(m)
    else this.see.delete(m)
    this.seeList = null
  }

  /** How an item is drawn: gone out of an isolation, see-through on a dimmed layer or stale, merged copper with any item stale, faded out of a focus or a faded isolation. */
  private itemState(u: PieceInfo, c: Pass, dimmed: boolean, layer = u.layer): PieceState {
    if (!isMaskGroup(layer) && (this.poseIds.has(u.id) || u.items?.some(i => this.poseIds.has(i.id)))) return 'gone'
    const iso = c.p.iso
    const out = !!iso && isoOut(u, iso)
    if (out && !iso!.fade) return 'gone'
    const stale = c.p.stale.ids
    if (dimmed || stale.has(u.id) || u.items?.some(i => stale.has(i.id))) return 'see'
    return (c.focus && !lit(u, c.kept)) || out ? 'fade' : null
  }

  /** Every batch, the slots' among them, and the barrels in their pieces' states. */
  private paintItems(c: Pass) {
    const items = this.built!
    for (const bt of items.batches) {
      const name = bt.group.name,
        dimmed = layerDimmed(name, this.layer)
      for (const m of bt.paint(u => this.itemState(u, c, dimmed, name), c.keep, this.variants))
        this.seen(m, isMaskGroup(name) || m.userData.hl === 'fade' || m.userData.hl === 'see')
    }
    const dimmed = layerDimmed('barrels', this.layer)
    for (const m of items.barrels?.paint(u => this.itemState(u, c, dimmed), c.keep, this.variants) ?? []) this.seen(m, m.userData.hl === 'fade' || m.userData.hl === 'see')
  }

  /** How a part's body is drawn: rimmed when kept, in focus on a kept net, else as an item is. */
  private bodyState(ref: string, c: Pass, dimmed: boolean): PieceState {
    const iso = c.p.iso
    const out = !!iso && !iso.parts.has(ref)
    if (out && !iso!.fade) return 'gone'
    if (dimmed || c.p.stale.refs.has(ref)) return 'see'
    return c.kept.parts.has(ref) ? 'rim' : (c.focus && !c.netRefs.has(ref)) || out ? 'fade' : null
  }
  private paintBodies(c: Pass) {
    const shown = this.parts.paint((ref, group) => this.bodyState(ref, c, layerDimmed(group, this.layer)), c.keep, this.variants)
    for (const m of shown) this.seen(m, m.userData.hl === 'fade' || m.userData.hl === 'see')
  }

  private paintSlabs(c: Pass) {
    const v = this.variants
    const inner = this.innerShown()
    const clear = c.focus && (c.kept.ids.size > 0 || c.kept.parts.size > 0 || [...c.p.sel.nets, ...c.p.anchor.nets].length > 0)
    const keep = (m: THREE.Mesh, st: HlState | null) => c.keep(m.userData.hl, st) as HlState | null
    for (const m of this.slabs) setState(m, keep(m, slabState({ inner, translucent: clear, dimmed: layerDimmed(this.groupOf(m), this.layer), focus: c.focus })), v)
    for (const m of this.masks) setState(m, keep(m, slabState({ inner: false, translucent: clear, dimmed: layerDimmed(this.groupOf(m), this.layer), focus: c.focus })), v)
    for (const m of [...this.slabs, ...this.masks]) {
      // an isolation of a definition placed several times leaves the board out
      m.visible = !(c.p.iso?.frame && !c.p.iso.fade)
      this.seen(m, !!m.userData.hl)
    }
    if (inner) {
      this.levels.get('fade')!.snap(1)
      v.setLevel('fade', 1)
    }
  }

  // the selection fades in once its members change
  private rim(c: Pass) {
    const sig = [...c.kept.ids, ...c.kept.parts].join()
    if (sig === this.wasRim) return
    this.wasRim = sig
    const t = this.levels.get('rim')!
    t.snap(0)
    t.set(1, performance.now())
  }

  /** The own meshes a lit set outlines: its items', never the merged copper under them, its nets' merged copper and its parts' bodies; never a mask skin. */
  private meshesOf(parts: Iterable<string>, ids: Iterable<number>, nets: Iterable<string>): THREE.Mesh[] {
    const out = new Set<THREE.Mesh>()
    const items = this.built
    if (!items || !this.b) return []
    const k: Keep = { ids: new Set(ids), parts: NO_NAMES, nets: new Set(nets) }
    const ix = boardIndex(this.b)
    const add = (m: THREE.Mesh | null) => m && out.add(m)
    const item = (id: number) => {
      if (this.poseIds.has(id)) return
      for (const bt of items.pieces.get(id) ?? []) if (!isMaskGroup(bt.group.name)) add(bt.own(id))
      for (const mem of items.members.get(id) ?? []) if (alone(mem.info, k)) add(memberMesh(mem, this.opts.cache))
      const i = items.barrelOf.get(id)
      if (i !== undefined) add(items.barrels!.own(i))
    }
    for (const id of k.ids) item(id)
    for (const n of k.nets) {
      ix.byNet(n).forEach(item)
      for (const [bt, id] of items.nets.get(n) ?? []) if (!isMaskGroup(bt.group.name) && !bt.info(id)?.items?.some(i => this.poseIds.has(i.id))) add(bt.own(id))
    }
    for (const r of parts) for (const m of this.bodyMeshes.get(r) ?? []) out.add(m)
    return [...out]
  }

  private outline() {
    const p = this.p
    this.outlines = {
      ctx: this.meshesOf([], [], p.ctx.nets),
      hover: this.meshesOf(p.hover.parts, p.hover.ids, p.hover.nets),
      sel: [...this.meshesOf(p.sel.parts, p.sel.ids, p.sel.nets), ...this.meshesOf([], this.ends, [])],
      anchor: this.meshesOf(p.anchor.parts, p.anchor.ids, p.anchor.nets),
    }
  }

  /** The items inside merged copper drawn over it, a hair nearer the camera, as one batch per layer and state: lit by themselves or their part, with the rim, or kept by an isolation that leaves the merged copper out. */
  private overlay(c: Pass) {
    const items = this.built!
    const iso = c.p.iso
    const shown = new Map<Member, HlState | null>()
    const ids = new Set(c.kept.ids)
    for (const r of c.kept.parts)
      if (this.b)
        boardIndex(this.b)
          .byRef(r)
          .forEach(id => ids.add(id))
    for (const id of ids)
      for (const mem of items.members.get(id) ?? []) if (!this.poseIds.has(id) && own(mem.info, c.kept) && !(iso && isoOut(mem.info, iso) && !iso.fade)) shown.set(mem, 'rim')
    if (iso)
      for (const list of items.members.values())
        for (const mem of list) {
          const under = mem.batch.info(mem.info.under.id)
          if (!shown.has(mem) && under && isoOut(under, iso) && !isoOut(mem.info, iso)) shown.set(mem, null)
        }
    if (this.poseIds.size)
      for (const [id, list] of items.members)
        for (const mem of list) {
          if (this.poseIds.has(id)) {
            shown.delete(mem)
            continue
          }
          const under = mem.batch.info(mem.info.under.id)
          if (!under?.items?.some(i => this.poseIds.has(i.id))) continue
          const st = this.itemState(mem.info, c, layerDimmed(mem.info.layer, this.layer))
          if (st !== 'gone') shown.set(mem, st)
        }
    const sig = [...shown].map(([m, st]) => `${m.info.id}:${m.info.layer}:${st}`).join()
    if (sig === this.overSig) {
      for (const ob of this.over)
        ob.paint(
          u => u.st,
          (_, st) => st,
          this.variants,
        )
      return
    }
    this.overSig = sig
    for (const ob of this.over) ob.dispose()
    const by = new Map<LayerBatch<PieceInfo>, LayerBatch<OverInfo>>()
    for (const [mem, st] of shown) {
      const geo = memberGeometry(mem, this.opts.cache)
      if (!geo) continue
      let ob = by.get(mem.batch)
      if (!ob) by.set(mem.batch, (ob = new LayerBatch<OverInfo>(mem.batch.group, raisedOf(mem.batch.material), mem.batch.place)))
      ob.fill(ob.add({ ...mem.info, st }), geo)
    }
    this.over = [...by.values()]
    for (const ob of this.over) {
      ob.flush()
      ob.paint(
        u => u.st,
        (_, st) => st,
        this.variants,
      )
    }
  }

  /** Per frame: the ramps advance; true while one moves. A fade that ran out drops the faded states it held. */
  step(now: number): boolean {
    let busy = false
    for (const [st, t] of this.levels) {
      const moving = t.step(now)
      this.variants.setLevel(st, t.value)
      busy ||= moving
    }
    const held = (m: THREE.Mesh) => (!this.wasFocus && (m.userData.hl === 'fade' || m.userData.hl === 'dim')) || (!this.wasSee && m.userData.hl === 'see')
    if (!busy && this.built && [...this.see].some(m => held(m as THREE.Mesh))) this.repaint()
    return busy
  }

  // ---- pick ----

  /** What a ray tests: each shown batch whole through its pick mesh, the instances, the slots and the members drawn alone; never a batch's draws. */
  private pickList(): THREE.Mesh[] {
    if (this.pickable) return this.pickable
    const out: THREE.Mesh[] = []
    const walk = (o: THREE.Object3D) => {
      const m = o as THREE.Mesh
      const whole = o.userData.batch?.pick === o
      if (!o.visible && !whole) return
      if (m.isMesh && m.geometry && (whole || o.userData.pick !== false)) {
        // a copy of an instanced mesh is tested by three.js, each against its own matrix
        const big = !(m as THREE.InstancedMesh).isInstancedMesh && (m.geometry.index?.count ?? m.geometry.attributes.position?.count ?? 0) > INDEXED * 3
        if (big && !m.userData.indexed) {
          indexRaycast(m)
          m.userData.indexed = true
        }
        out.push(m)
      }
      for (const c of o.children) walk(c)
    }
    walk(this.root)
    return (this.pickable = out)
  }
  /** Build pick grids while `left()` ms remain; true while some are left. */
  warm(left: () => number): boolean {
    while (this.warmList.length && left() > 2) this.warmList.pop()!.userData.warmIndex()
    return this.warmList.length > 0
  }

  /** What a ray in world space picks: of its hits within a hair of the nearest the item of lowest rank, never a piece out of the drawing or what the last edit made stale. */
  pick(ray: THREE.Ray, stale: Stale): ScenePick | null {
    this.ray.ray.copy(ray)
    const hits = this.ray.intersectObjects(this.pickList(), false).filter(h => !h.object.userData.batch || h.object.userData.batch.itemAt(h.faceIndex ?? -1))
    if (!hits.length) return null
    const group = this.groupOf(hits[0].object)
    const best = bestHit(hits, i => (i.kind === 'body' ? !!i.ref && stale.refs.has(i.ref) : stale.ids.has(i.id)))
    const local = this.root.worldToLocal(hits[0].point.clone())
    const at: [number, number] = [local.x, -local.y]
    return best && best.info ? { ...best, group, at } : { info: null, group, at }
  }

  // ---- pose ----

  /** The own meshes of an item, never a mask skin: its pieces', its members' and its plating's. */
  private ownOf(id: number): THREE.Mesh[] {
    const items = this.built
    if (!items) return []
    const out: THREE.Mesh[] = []
    for (const bt of items.pieces.get(id) ?? []) {
      const m = !isMaskGroup(bt.group.name) && bt.own(id)
      if (m) out.push(m)
    }
    for (const mem of items.members.get(id) ?? []) {
      const m = memberMesh(mem, this.opts.cache)
      if (m) out.push(m)
    }
    const i = items.barrelOf.get(id)
    if (i !== undefined) out.push(items.barrels!.own(i))
    return out
  }

  /** The items a pose draws again: the pads of its parts and its items of no part, an instance's routes and texts. */
  private posedIds(p: Pose): number[] {
    const ix = boardIndex(this.b!)
    const pads = [...p.parts].flatMap(ref => ix.byRef(ref).filter(id => ix.item(id)?.kind === 'pad'))
    return [...pads, ...p.ids]
  }

  /** Copies of the posed items' own meshes in the outline's rim, in the shown frame's inverse so one matrix moves them all. */
  private makeGhosts(p: Pose | null) {
    const frame = this.frame
    const key = p?.held.layers ? [...p.parts].sort().join() + '|' + [...p.ids].sort().join() + '|' + frame.elements.join() : ''
    if (key === this.ghostKey && this.ghostBoard === this.b) return
    this.ghostKey = key
    this.ghostBoard = this.b
    this.ghosts.clear()
    this.poseIds = new Set(p?.held.layers && this.b ? this.posedIds(p) : [])
    if (!p?.held.layers || !this.b || !this.built) return
    const inFrame = frame.clone().invert()
    for (const id of this.posedIds(p))
      for (const m of this.ownOf(id)) {
        m.updateWorldMatrix(true, false)
        const g = new THREE.Mesh(m.geometry, this.variants.get(this.baseOf(m), 'rim'))
        g.matrixAutoUpdate = false
        g.matrix.multiplyMatrices(inFrame, m.matrixWorld)
        g.raycast = () => {}
        g.renderOrder = 3
        g.userData.id = id
        this.ghosts.add(g)
      }
  }

  /** A pose drawn: the parts' bodies moved while it holds meta, their pads and its items drawn again where it goes while it holds layers, by one matrix, no geometry made per move. */
  pose(p: Pose | null) {
    const before = this.ghostKey
    const board = this.ghostBoard
    this.makeGhosts(p)
    const changed = before !== this.ghostKey || board !== this.ghostBoard
    const turn = new THREE.Matrix4()
    if (p) {
      const [ox, oy] = p.origin
      turn
        .makeTranslation(ox + p.delta[0], -(oy + p.delta[1]), 0)
        .multiply(new THREE.Matrix4().makeRotationZ((p.angle * Math.PI) / 180))
        .multiply(new THREE.Matrix4().makeTranslation(-ox, oy, 0))
    }
    this.ghosts.matrix.multiplyMatrices(this.frame, turn)
    this.ghosts.matrixWorldNeedsUpdate = true
    const was = this.posed
    for (const o of was) {
      o.position.set(0, 0, 0)
      o.quaternion.identity()
      o.updateMatrix()
    }
    this.posed = p?.held.meta ? this.bodies.filter(o => p.parts.has(o.userData.ref)) : []
    for (const o of this.posed) {
      turn.decompose(o.position, o.quaternion, o.scale)
      o.updateMatrix()
    }
    for (const o of new Set([...was, ...this.posed])) this.parts.move(o.userData.ref)
    // a moved part draws its own meshes until the pose ends
    if (this.parts.setPosed(new Set(this.posed.map(o => o.userData.ref)))) this.repaint()
    else if (changed) this.repaint()
  }
  /** The material a mesh is drawn in at rest. */
  private baseOf(m: THREE.Mesh): THREE.Material {
    return (m.userData.base ?? m.material) as THREE.Material
  }

  dispose() {
    this.disposed = true
    this.clear()
    this.variants.dispose()
  }
}
