<script setup lang="ts">
// one three.js unit is a millimetre; board (x, y) is three (x, -y), z up, the slab from z = 0 to its thickness
import { computed, onBeforeUnmount, onMounted, reactive, ref, toRaw, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import type { SiteData, SiteFootprint } from '@pcbjs/core/site-data'
import type { ModelSpec } from '@pcbjs/core/types'
import { describe, getModel } from './models'
import { modelChoice } from './models/choice'
import { stepModel } from './models/step'
import { missingModel } from './models/missing'
import { referenceGroup, referenceUrl } from './scene/reference'
import { appBase, assetUrl } from './variants'
import { clickOf, linkHint, sourceTarget, useStore, type SourceKind } from './state'
import { sideColors } from './stackup'
import { inside } from './scene/shapes'
import { copperIds, copperSlices, maskThickness, SILK, type Slice } from './scene/stack'
import { batches, buildItems, GeometryCache, maskInfo, sliceOf, type BuiltItems, type ItemInfo, type MaskInfo } from './scene/items'
import { flatten, GeometryPool, hashRings, jobSize, packDrills, runJob, toGeometry, type GeoJob, type GeoResult } from './scene/geometry'
import { LOOK, STATES, Variants, setState, type HlState } from './scene/highlight'
import { hlStrength } from './scene/intensity'
import { FOCUS_DIR, ISO_DIR, SUN, UNDER } from './scene/lights'
// FOCUS_DIR mirrored under the board, from the north so the back reads left to right as in the bottom view
const FOCUS_BELOW: [number, number, number] = [FOCUS_DIR[0], -FOCUS_DIR[1], -FOCUS_DIR[2]]
import { EASE_OUT, Spring, Tween } from './scene/motion'
import { Grid } from './scene/grid'
import { fitBeside, fitDistance, fitSphere, stackBox } from './scene/fit'
import { StackFit, poseOf, positionOf } from './scene/stack-fit'
import { dielectrics, offsets, stackOrder } from './scene/explode'
import { anchor, calloutOpacity, column, hull, leader, type P2 } from './scene/callouts'
import { gridSegs, outlineSegs, type Ring } from './scene/wire'
import { gridStep } from './grid'
import { inScope, layerDimmed, slabState, translucent, type Hovered, type Scope } from './scene/focus'
import { netRoles, routeHover } from './routes'
import { setReady } from './ready'

type Picked = { ref?: string; id: number | null; kind: string; net?: string }
type OpenItem = Picked & { meta: boolean; shift: boolean; alt: boolean; ctrl: boolean }

const props = withDefaults(defineProps<{ board: SiteData; hidden: Set<string>
  activeNet?: string | null
  /** a net hovered in a side panel, tinted like a hovered item without the focus fade */
  hoverNet?: string | null
  activeRef?: string | null
  /** footprint refs of the source highlight, tinted in the accent */
  sourceRefs?: Set<string> | null
  /** item ids of the source highlight, tinted in the accent */
  sourceIds?: readonly number[] | Set<number> | null
  /** board points of the source highlight, marked with an accent ring over the top face */
  sourcePoints?: readonly [number, number][] | null
  /** the parts of a multi-part selection, tinted in the selection colour */
  selectedRefs?: readonly string[]
  /** the circuit instance hovered in the side panel, tinted faintly */
  hoverRefs?: readonly string[]
  fade?: boolean
  explode?: boolean
  separation?: number
  /** a part to frame at once, as ?select= asks */
  frameRef?: string | null
  /** open on the bottom, as ?side=bottom asks */
  fromBelow?: boolean
  /** the focus a hover is held to: outside it a hover is a bare outline and reaches nothing else */
  scope?: Scope | null }>(), { fade: undefined, explode: undefined, separation: undefined })
const emit = defineEmits<{
  select: [Picked | null]
  open: [string, SourceKind, OpenItem]
  net: [string | null]
  hover: [(Picked & { layer: string }) | null]
  'update:fade': [boolean]
  'update:explode': [boolean]
  'update:separation': [number]
}>()

const { source: src, ui: page, toggleGrid } = useStore()
const host = ref<HTMLDivElement>()
const hover = ref<{ title: string; value: string; detail: string; x: number; y: number; item: ItemInfo | null; ref?: string } | null>(null)
const hoverSrc = computed(() => {
  const h = hover.value
  if (!src.meta || !h) return null
  const t = sourceTarget(props.board, { id: h.item && h.item.kind !== 'body' ? h.item.id : null, ref: h.ref }, src.shift ? 'definition' : 'placement')
  return t ? `${t.file}:${t.start[0]}` : 'no source location'
})

// fade, explode and separation follow their props when given, else what this browser remembers
const ui = reactive({ fade: props.fade ?? true, explode: props.explode ?? false, separation: props.separation ?? 4 })
const fadeOn = computed(() => ui.fade)
const focusOn = computed(() => focusActive())
/** how the content out of a focus is drawn, remembered by this browser */
const look = reactive({ ...LOOK })
const store = {
  get(k: string): string | null { try { return localStorage.getItem(k) } catch { return null } },
  set(k: string, v: string) { try { localStorage.setItem(k, v) } catch { /* private mode */ } },
}

const PARTS = '#5b6270'
const COLORS = { mask: '#1b5e20', silk: '#f4f4f4', fr4: '#a8955f', edge: '#b9a978', copper: '#c87533' }
const FINISH: Record<string, string> = { ENIG: '#d9b24c', HardGold: '#d9b24c', HASL: '#c9cccf', LeadFreeHASL: '#c9cccf', ImmersionSilver: '#d4d6d8', ImmersionTin: '#c4c6c8', OSP: '#c87533' }
// the palette colour is the mask over bare laminate in the top light, so the albedo is that colour over MASK_GAIN
const MASK_GAIN = 2.4
/** the weakest tint of a part body, as a fraction of the full one */
const BODY_MIN = 0.35
const MASK_OPACITY = 0.94
function maskShades(hex: string): { bare: THREE.Color; copper: THREE.Color } {
  const base = new THREE.Color(hex)
  const s = base.getHSL({ h: 0, s: 0, l: 0 }).s
  // mixed in sRGB, as the eye mixes the copper showing through, then lit back down to an albedo in linear
  const a = base.getRGB(new THREE.Color(), THREE.SRGBColorSpace), cu = new THREE.Color(COLORS.copper).getRGB(new THREE.Color(), THREE.SRGBColorSpace)
  const k = 0.08 + 0.16 * s
  const copper = new THREE.Color().setRGB(a.r + (cu.r - a.r) * k, a.g + (cu.g - a.g) * k, a.b + (cu.b - a.b) * k, THREE.SRGBColorSpace).offsetHSL(0, 0, 0.03 + 0.03 * s)
  return { bare: base.clone().multiplyScalar(1 / MASK_GAIN), copper: copper.multiplyScalar(1 / MASK_GAIN) }
}

let renderer: THREE.WebGLRenderer | null = null
let callLayer: HTMLDivElement | null = null, leaders: SVGSVGElement | null = null
let envMap: THREE.Texture | null = null
let scene: THREE.Scene, camera: THREE.PerspectiveCamera, controls: OrbitControls
let boardGroup: THREE.Group | null = null
let groups = new Map<string, THREE.Group>()
let built: BuiltItems | null = null
let bodies: THREE.Group[] = []
let bodyMeshes = new Map<string, THREE.Mesh[]>()
let stepLoads: Promise<void>[] = []
let slabMeshes: THREE.Mesh[] = [], maskMeshes: THREE.Mesh[] = []
/** a callout: its label, its leader, its layer group and its height in the group, mm */
let labels: { el: HTMLDivElement; leader: SVGPathElement; group: string; z: number; width: number; on: boolean }[] = []
/** the outline's hull in three's x and y, the callout anchors' candidates */
let ring: P2[] = []
/** the parts and silk planes' wireframes: the outline, and the grid redrawn at the ground grid's step */
let wires: { group: string; outline: THREE.LineSegments; grid: THREE.LineSegments; z: number }[] = []
let wireStep = 0, wireRings: Ring[] = []
const hoverLayer = ref<string | null>(null)
let disposables: { dispose(): void }[] = []
let slices = new Map<string, Slice>()
let order: string[] = []
const geoCache = new GeometryCache()
const pool = new GeometryPool(() => new Worker(new URL('./scene/geometry.worker.ts', import.meta.url), { type: 'module' }), Math.max(1, Math.min(4, (typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 4) - 1)))
let gen = 0, alive = true
// complete once every geometry of this build is in; readySent once per build and per explode change
let complete = false, readySent = false
const grid = new Grid()
let gridBaseZ = 0
let variants: Variants | null = null
let dirty = true, raf = 0, fitted = false
let ro: ResizeObserver | null = null, mo: MutationObserver | null = null, mq: MediaQueryList | null = null
const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2()
let downAt: [number, number] | null = null

const track = <T extends { dispose(): void }>(d: T): T => { disposables.push(d); return d }

function safeColor(c: string | null): THREE.Color | null {
  if (!c || !CSS.supports('color', c)) return null
  try { return new THREE.Color(c) } catch { return null }
}
function maskColor(side: 'F' | 'B'): string {
  const c = safeColor(sideColors(props.board.stackup, side).mask)
  return c ? `#${c.getHexString()}` : COLORS.mask
}
function silkColor(side: 'F' | 'B'): string {
  const c = safeColor(sideColors(props.board.stackup, side).silk)
  return c ? `#${c.getHexString()}` : COLORS.silk
}
function cssColor(name: string, fallback: string) {
  const v = host.value ? getComputedStyle(host.value).getPropertyValue(name).trim() : ''
  try { return new THREE.Color(v || fallback).getStyle() } catch { return fallback }
}

let mats: { outer: THREE.MeshStandardMaterial; inner: THREE.MeshStandardMaterial; silk: Record<'F' | 'B', THREE.MeshStandardMaterial>; barrel: THREE.MeshStandardMaterial
  slab: THREE.MeshStandardMaterial[]; mask: Record<'F' | 'B', Record<'bare' | 'copper', THREE.MeshPhysicalMaterial>> } | null = null
function makeMaterials(b: SiteData) {
  const finish = FINISH[b.stackup?.finish ?? ''] ?? FINISH.HASL
  const std = (p: THREE.MeshStandardMaterialParameters) => track(new THREE.MeshStandardMaterial(p))
  // low specular, thin sharp clearcoat: a broad specular lobe under these lights washes the colour out to grey
  const mask = (side: 'F' | 'B') => {
    const shades = maskShades(maskColor(side))
    const one = (color: THREE.Color) => track(new THREE.MeshPhysicalMaterial({ color, roughness: 0.55, metalness: 0, specularIntensity: 0.15, clearcoat: 0.2, clearcoatRoughness: 0.1, envMapIntensity: 0.1, transparent: true, opacity: MASK_OPACITY, depthWrite: false }))
    return { bare: one(shades.bare), copper: one(shades.copper) }
  }
  mats = {
    outer: std({ color: finish, roughness: 0.32, metalness: 0.75 }),
    inner: std({ color: COLORS.copper, roughness: 0.4, metalness: 0.6 }),
    silk: { F: std({ color: silkColor('F'), roughness: 0.8 }), B: std({ color: silkColor('B'), roughness: 0.8 }) },
    barrel: std({ color: finish, roughness: 0.35, metalness: 0.7, side: THREE.DoubleSide }),
    slab: [std({ color: COLORS.fr4, roughness: 0.7 }), std({ color: COLORS.edge, roughness: 0.85 })],
    mask: { F: mask('F'), B: mask('B') },
  }
}

// more holes than this show a whole slab until the worker's cut one lands
const SYNC_HOLES = 120
function outlineFlat(b: SiteData) {
  const bb = b.bbox
  const rect: [number, number][] = [[bb.x, bb.y], [bb.x + bb.w, bb.y], [bb.x + bb.w, bb.y + bb.h], [bb.x, bb.y + bb.h]]
  return flatten(b.outline.length ? b.outline : [rect])
}
function slabJob(b: SiteData, depth: number, drills: SiteData['drills'], openings: [number, number][][]): GeoJob {
  const outline = outlineFlat(b), op = openings.length ? flatten(openings) : undefined
  const dr = packDrills(drills)
  const key = `slab:${depth}:${hashRings(outline)}:${hashRings({ xy: dr, len: new Uint32Array([drills.length]) })}:${op ? hashRings(op) : ''}`
  return { kind: 'slab', key, outline, drills: dr, ...(op ? { openings: op } : {}), depth }
}
/** From the cache, cut here with few holes, else whole now with the cut job queued for the worker. */
function slabMesh(job: Extract<GeoJob, { kind: 'slab' }>, holes: number, mat: THREE.Material | THREE.Material[], queue: GeoJob[]): THREE.Mesh {
  let geo = geoCache.get(job.key)
  if (geo === undefined) {
    if (holes <= SYNC_HOLES) { geo = toGeometry(runJob(job)); geoCache.put(job.key, geo) }
    else {
      const whole = { ...job, key: `${job.key}:whole`, drills: new Float64Array(0), openings: undefined, outline: { xy: job.outline.xy, len: job.outline.len.subarray(0, 1) } }
      geo = geoCache.get(whole.key)
      if (geo === undefined) { geo = toGeometry(runJob(whole)); geoCache.put(whole.key, geo) }
      queue.push(job)
    }
  }
  const m = new THREE.Mesh(geo ?? new THREE.BufferGeometry(), mat)
  m.userData.slabKey = job.key
  return m
}
function slabSlice(b: SiteData, z0: number, z1: number, queue: GeoJob[]): THREE.Mesh {
  // lids in group 0, sides in group 1
  const m = slabMesh(slabJob(b, z1 - z0, b.drills, []) as Extract<GeoJob, { kind: 'slab' }>, b.drills.length + b.outline.length, mats!.slab, queue)
  m.position.z = z0
  m.userData.pick = 'slab'; m.userData.base = m.material
  slabMeshes.push(m)
  return m
}

// not pickable: a click goes through to the copper under it
const KEEPOUT_DEPTH = 0.15
function buildKeepouts(b: SiteData, group: (name: string) => THREE.Group) {
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
        fill: track(new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide })),
        line: track(new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: 0.9 })),
      }
      kmats.set(layer, m)
    }
    return m
  }
  for (const k of b.keepouts) {
    const shapes = k.outline.filter(r => r.length > 2).map(r => new THREE.Shape(r.map(([x, y]) => new THREE.Vector2(x, -y))))
    if (!shapes.length) continue
    const geo = track(new THREE.ExtrudeGeometry(shapes, { depth: KEEPOUT_DEPTH, bevelEnabled: false, curveSegments: 1 }))
    const edges = track(new THREE.EdgesGeometry(geo, 30))
    for (const layer of k.layers) {
      const s = slices.get(layer)
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
      group(layer).add(m, e)
    }
  }
}

function npthHoles(b: SiteData): [number, number][][] {
  const out: [number, number][][] = []
  for (const it of b.items ?? []) if (it.kind === 'pad' && it.drill && !it.layers.some(l => l.endsWith('.Cu')) && it.rings.length > 1) out.push(it.rings[1])
  return out
}

// NPTH holes go through the mask too, unless an opening already clears them
function maskSlab(b: SiteData, side: 'F' | 'B', mask: MaskInfo, queue: GeoJob[]): THREE.Mesh {
  const open = mask.openings[side].rings
  const npth = npthHoles(b).filter(h => {
    const xs = h.map(p => p[0]), ys = h.map(p => p[1])
    const c: [number, number] = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]
    return !open.some(r => inside(c, r))
  })
  const t = mask.thickness[side]
  const m = slabMesh(slabJob(b, t, [], [...open, ...npth]) as Extract<GeoJob, { kind: 'slab' }>, open.length + npth.length, mats!.mask[side].bare, queue)
  m.position.z = side === 'F' ? slices.get('F.Cu')!.z0 : slices.get('B.Cu')!.z1 - t
  m.userData.pick = false; m.userData.base = m.material
  m.renderOrder = 1
  maskMeshes.push(m)
  return m
}

// back parts turn over about the model's y axis: the footprint mirrored in x, printed side readable from below
function placeBody(fp: SiteFootprint, b: SiteData): THREE.Group {
  const { body, height } = fp
  const back = fp.side === 'B'
  // a box is no model, drawn as its outline with the ref; the `none` model has no body, see ./models/choice
  const spec: ModelSpec | null = modelChoice(fp)
  const model = spec?.kind === 'box' ? missingModel(spec.w, spec.h, spec.height, fp.ref)
    : spec ? getModel(spec, { value: fp.value, fields: fp.fields ?? {}, body, height, thickness: b.thickness }) : new THREE.Group()
  // the outline is made per part, so it goes with the board
  if (spec?.kind === 'box') model.traverse(o => { const m = o as THREE.Mesh; if (m.geometry) track(m.geometry); const map = (m.material as THREE.MeshBasicMaterial | undefined)?.map; if (map) { track(map); track(m.material as THREE.Material) } })
  const wrap = new THREE.Group()
  wrap.userData.ref = fp.ref
  const g = new THREE.Group()
  wrap.add(g)
  const face = back ? slices.get('B.Cu')!.z0 : slices.get('F.Cu')!.z1
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
  const meshesOf = (o: THREE.Object3D) => { const out: THREE.Mesh[] = []; o.traverse(m => { if ((m as THREE.Mesh).isMesh) { m.userData.strength = strength; m.userData.noOutline = true; out.push(m as THREE.Mesh) } }); return out }
  bodyMeshes.set(fp.ref, meshesOf(g))
  if (fp.step) {
    const my = gen
    stepLoads.push(stepModel(fp.ref, fp.step, fp, face, !!b.dev).then(m => {
      if (!m || my !== gen || !alive) return
      wrap.remove(g)
      wrap.add(m)
      bodyMeshes.set(fp.ref, meshesOf(m))
      applyHighlight()
      dirty = true
    }))
  }
  return wrap
}

function label(text: string, title: string, color: string, group: string): HTMLDivElement {
  const el = document.createElement('div')
  el.title = title
  el.className = 'view3d-callout'
  el.textContent = text
  el.style.setProperty('--c', color)
  el.addEventListener('pointerenter', () => setLayerHover(group))
  el.addEventListener('pointerleave', () => setLayerHover(null))
  return el
}

const WIRE = { outline: 0.75, grid: 0.3 }
function wireLines(pts: number[], z: number, color: string, opacity: number): THREE.LineSegments {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(flatToXyz(pts, z), 3))
  const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }))
  l.userData.opacity = opacity
  l.raycast = () => {}
  return l
}
const flatToXyz = (pts: number[], z: number) => { const out: number[] = []; for (let i = 0; i < pts.length; i += 2) out.push(pts[i], pts[i + 1], z); return out }
/** A plane of the exploded stack: the outline and its inner grid at height `z` in the group `name`. */
function wirePlane(name: string, z: number, color: string) {
  const outline = wireLines(outlineSegs(wireRings), z, color, WIRE.outline), grid = wireLines([], z, color, WIRE.grid)
  outline.visible = grid.visible = false
  groups.get(name)!.add(outline, grid)
  disposables.push({ dispose: () => { for (const l of [outline, grid]) { l.geometry.dispose(); (l.material as THREE.Material).dispose() } } })
  wires.push({ group: name, outline, grid, z })
}
/** Per frame while the planes show: their grids follow the ground grid's step. */
function stepWires() {
  if (!wires.some(w => w.grid.visible)) return
  const step = gridStep(pxPerMm()).minor
  if (step === wireStep) return
  wireStep = step
  const pts = gridSegs(wireRings, step)
  for (const w of wires) w.grid.geometry.setAttribute('position', new THREE.Float32BufferAttribute(flatToXyz(pts, w.z), 3))
  dirty = true
}

function buildBoard() {
  if (!scene) return
  const t0 = performance.now()
  if (boardGroup) scene.remove(boardGroup)
  for (const l of labels) { l.el.remove(); l.leader.remove() }
  wires = []; wireStep = 0
  hoverLayer.value = null
  for (const d of disposables) d.dispose()
  disposables = []
  variants?.dispose()
  // raw: through the reactive proxy, reading every ring point is ten times slower
  const b = toRaw(props.board)
  const my = ++gen
  complete = false; readySent = false
  const queue: GeoJob[] = []
  slices = copperSlices(b)
  makeMaterials(b)
  boardGroup = new THREE.Group()
  groups = new Map()
  slabMeshes = []; maskMeshes = []; labels = []; bodyMeshes = new Map(); stepLoads = []
  const group = (name: string) => { let g = groups.get(name); if (!g) { g = new THREE.Group(); g.name = name; groups.set(name, g); boardGroup!.add(g) } return g }
  order = stackOrder(b)
  for (const name of order) group(name)

  const mask = maskInfo(b, { F: maskThickness(b, 'F'), B: maskThickness(b, 'B') })
  built = buildItems(b, slices, mask, { copper: l => (l === 'F.Cu' || l === 'B.Cu' ? mats!.outer : mats!.inner), silk: s => mats!.silk[s], barrel: mats!.barrel, mask: s => mats!.mask[s].copper }, geoCache, group)

  buildKeepouts(b, group)

  const diel = dielectrics(b, slices)
  for (const d of diel) group(d.name).add(slabSlice(b, d.z0, d.z1, queue))
  group('F.Mask').add(maskSlab(b, 'F', mask, queue))
  group('B.Mask').add(maskSlab(b, 'B', mask, queue))

  // models are shared from the module cache in ./models, never disposed here
  bodies = b.footprints.map(fp => placeBody(fp, b))
  for (const o of bodies) group(o.children[0] instanceof THREE.Group && b.footprints.find(f => f.ref === o.userData.ref)?.side === 'B' ? 'bodies:B' : 'bodies:F').add(o)

  buildOverlay(b, group('overlay'), mask)
  // the first fit frames the references once they land
  const refLoads = (b.references ?? []).filter(r => r.mesh).map(r => referenceGroup(r, referenceUrl(r.mesh!, !!b.dev, p => assetUrl(p, appBase(import.meta.env?.BASE_URL ?? '/', location.pathname)))).then(o => { if (o && my === gen && alive) { group('References').add(o); dirty = true } }))
  if (refLoads.length) { const fresh = !fitted; stepLoads.push(Promise.all(refLoads).then(() => { if (fresh && my === gen && alive && !props.frameRef) { applyVisibility(); view(firstView()) } })) }

  // each callout hangs off the outline's rightmost point on screen, found among the hull's vertices every frame
  const bb = b.bbox
  const pts: P2[] = b.outline.length ? b.outline.flat().map(([x, y]) => [x, -y]) : [[bb.x, -bb.y], [bb.x + bb.w, -bb.y], [bb.x + bb.w, -bb.y - bb.h], [bb.x, -bb.y - bb.h]]
  ring = hull(pts)
  wireRings = b.outline.length ? b.outline.map(r => r.map(([x, y]) => [x, -y] as const)) : [pts]
  const rail = new Map(b.layers.map(l => [l.id, l]))
  const silkT = (side: 'F' | 'B') => {
    const l = b.stackup?.layers.find(s => s.type === 'silk' && s.side === side) as { thickness?: number } | undefined
    return l?.thickness ?? SILK
  }
  const mm = (v: number) => `${+v.toFixed(3)} mm`
  const callout = (name: string, text: string, title: string, color: string, z: number) => {
    const el = label(text, title, color, name)
    el.style.display = 'none'
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    line.style.setProperty('--c', color)
    line.style.display = 'none'
    callLayer?.append(el)
    leaders?.append(line)
    labels.push({ el, leader: line, group: name, z, width: 0, on: false })
  }
  const railOf = (id: string, fallback: string) => rail.get(id)?.color ?? fallback
  for (const id of copperIds(b.copper)) {
    const s = slices.get(id)!
    callout(id, id, `${id}, ${rail.get(id)?.name ?? 'copper'}, ${mm(s.z1 - s.z0)}`, railOf(id, '#c87533'), (s.z0 + s.z1) / 2)
  }
  for (const d of diel) callout(d.name, d.kind, `${d.label}`, COLORS.fr4, (d.z0 + d.z1) / 2)
  for (const side of ['F', 'B'] as const) {
    const cu = slices.get(`${side}.Cu`)!, t = mask.thickness[side]
    callout(`${side}.Mask`, `${side}.Mask`, `${side}.Mask, ${rail.get(`${side}.Mask`)?.name ?? 'solder mask'}, ${mm(t)}, ${maskColor(side)}`, maskColor(side), side === 'F' ? cu.z1 + t / 2 : cu.z0 - t / 2)
    const s = sliceOf(`${side}.SilkS`, slices, mask.thickness)!
    callout(`${side}.SilkS`, `${side}.SilkS`, `${side}.SilkS, ${rail.get(`${side}.SilkS`)?.name ?? 'silkscreen'}, ${mm(silkT(side))}`, railOf(`${side}.SilkS`, '#d0d0d0'), (s.z0 + s.z1) / 2)
    wirePlane(`${side}.SilkS`, side === 'F' ? s.z0 : s.z1, railOf(`${side}.SilkS`, '#d0d0d0'))
    const n = b.footprints.filter(f => f.side === side).length
    if (!n) continue
    callout(`bodies:${side}`, 'parts', `${n} ${side === 'F' ? 'front' : 'back'} part${n === 1 ? '' : 's'}`, PARTS, side === 'F' ? cu.z1 + 0.6 : cu.z0 - 0.6)
    wirePlane(`bodies:${side}`, side === 'F' ? cu.z1 + t : cu.z0 - t, PARTS)
  }

  scene.add(boardGroup)
  // the grid under the unexploded board, bodies included
  explodeNow = -1
  applyExplode(0)
  boardGroup.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(boardGroup)
  if (!box.isEmpty()) { grid.build(box); gridBaseZ = grid.z }
  applyExplode(sepNow)
  applyVisibility()
  applyHighlight()
  dirty = true
  if (!fitted) { view(firstView()); frameNow(); fitted = true }
  if (import.meta.env.DEV) { buildMs = performance.now() - t0; buildStart = t0; landings.push([Math.round(t0), 0, 'build', Math.round(buildMs)]); geometryMs = 0; (window as any).__pcbjs3d = { scene, camera, mats, groups, render: () => { dirty = true } } }
  buildRest(my, built, queue)
}

// up to this many points the rest builds here at once, as one frame
const SYNC_POINTS = 20000
function buildRest(my: number, items: BuiltItems, slabs: GeoJob[]) {
  const jobs = [...items.jobs, ...slabs]
  // complete once the STEP meshes are in too, so a screenshot shows them
  const steps = stepLoads
  const done = () => { if (steps.length) Promise.all(steps).then(finish); else finish() }
  const finish = () => {
    if (my !== gen) return
    complete = true
    dirty = true
    geoCache.sweep()
    if (import.meta.env.DEV) { geometryMs = performance.now() - buildStart; completeAt ||= performance.now() }
  }
  const land = (results: GeoResult[]) => {
    if (!alive) return
    const t = performance.now()
    const added = items.fill(results)
    let swapped = 0
    for (const r of results) {
      if (!r.key.startsWith('slab:')) continue
      const geo = geoCache.get(r.key)
      if (my === gen && geo) for (const m of [...slabMeshes, ...maskMeshes]) if (m.userData.slabKey === r.key) { m.geometry = geo; swapped++ }
    }
    if (my === gen && (added || swapped)) { applyHighlight(); dirty = true }
    if (import.meta.env.DEV) landings.push([Math.round(t - buildStart), results.length, results[0]?.key.split(':')[0] ?? '', Math.round(performance.now() - t)])
  }
  if (!jobs.length) { done(); return }
  const points = jobs.reduce((n, j) => n + jobSize(j), 0)
  if (points <= SYNC_POINTS) { land(jobs.map(runJob)); done(); return }
  // a job another build already sent is not sent again: this build waits for the same result
  const waits: Promise<void>[] = []
  const fresh = jobs.filter(j => { const p = inflight.get(j.key); if (p) waits.push(p.then(r => land([r]))); return !p })
  for (const batch of batches(fresh)) {
    const sent = pool.run(batch)
    batch.forEach((j, i) => { const p = sent.then(r => r[i]); inflight.set(j.key, p); p.then(() => inflight.delete(j.key)) })
    waits.push(sent.then(land))
  }
  Promise.all(waits).then(done)
}
const inflight = new Map<string, Promise<GeoResult>>()

function buildOverlay(b: SiteData, g: THREE.Group, mask: MaskInfo) {
  const z = sliceOf('F.SilkS', slices, mask.thickness)!.z1 + 0.05
  if (b.ratsnest.length) {
    const pts: number[] = []
    for (const r of b.ratsnest) pts.push(r.from[0], -r.from[1], z, r.to[0], -r.to[1], z)
    const geo = track(new THREE.BufferGeometry())
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    const m = new THREE.LineSegments(geo, track(new THREE.LineBasicMaterial({ color: cssColor('--rats', '#e8c547'), transparent: true, opacity: 0.9, depthTest: false })))
    m.renderOrder = 5
    m.userData.pick = false
    g.add(m)
  }
  if (b.drc.length) {
    const ring = track(new THREE.RingGeometry(0.45, 0.62, 32))
    const err = track(new THREE.MeshBasicMaterial({ color: cssColor('--drc-err', '#ff5c5c'), side: THREE.DoubleSide, depthTest: false, transparent: true }))
    const warn = track(new THREE.MeshBasicMaterial({ color: cssColor('--drc-warn', '#ffc23d'), side: THREE.DoubleSide, depthTest: false, transparent: true }))
    const info = track(new THREE.MeshBasicMaterial({ color: cssColor('--drc-info', '#6ea8ff'), side: THREE.DoubleSide, depthTest: false, transparent: true }))
    for (const d of b.drc) {
      const m = new THREE.Mesh(ring, d.severity === 'error' ? err : d.severity === 'info' ? info : warn)
      m.position.set(d.at[0], -d.at[1], z)
      m.renderOrder = 6
      m.userData.pick = false
      g.add(m)
    }
  }
}

let marks: THREE.Group | null = null
function markPoints() {
  if (marks) { marks.parent?.remove(marks); for (const c of marks.children) { const m = c as THREE.Mesh; m.geometry.dispose(); (m.material as THREE.Material).dispose() } marks = null }
  const pts = props.sourcePoints ?? []
  if (!boardGroup || !pts.length) { dirty = true; return }
  marks = new THREE.Group()
  const mat = new THREE.MeshBasicMaterial({ color: cssColor('--accent', '#6ea8ff'), side: THREE.DoubleSide, depthTest: false, transparent: true })
  const z = props.board.thickness + 0.1
  for (const [x, y] of pts) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.62, 32), mat.clone())
    m.position.set(x, -y, z)
    m.renderOrder = 7
    m.userData.pick = false
    marks.add(m)
  }
  mat.dispose()
  boardGroup.add(marks)
  dirty = true
}

let sepNow = 0, explodeNow = -1
const sepSpring = new Spring(0, { response: 0.35, damping: 0.85 })
const sepTarget = () => (ui.explode ? Math.max(0, Math.min(15, ui.separation)) : 0)
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
function startExplode() {
  readySent = false
  if (reduced()) sepSpring.snap(sepTarget())
  else sepSpring.set(sepTarget())
  dirty = true
}
/** Explode toggled: the camera frames the stack at its target separation, landing with the explode. */
function onExplode() {
  const s0 = sepSpring.value
  startExplode()
  if (!camera || !fitted) return
  const dir = camera.position.clone().sub(controls.target).normalize()
  const { centre, dist } = frame(dir)
  const near = Math.max(0.05, dist / 200), far = dist * 20
  const from = poseOf(controls.target, camera.position), to = poseOf(centre, centre.clone().addScaledVector(dir, dist))
  if (reduced() || !stackFit.start(from, to, s0, sepSpring.target)) return moveCamera(centre, dir, dist, near, far, reduced())
  camMoving = false
  camera.near = Math.min(near, camera.near); camera.far = Math.max(far, camera.far); camNearFar = [near, far]
  camera.updateProjectionMatrix()
}
function stepStackFit() {
  if (!stackFit.active) return
  const p = stackFit.at(sepSpring.value)!
  controls.target.copy(p.target)
  camera.position.copy(positionOf(p))
  dirty = true
  if (!stackFit.active && camNearFar) { camera.near = camNearFar[0]; camera.far = camNearFar[1]; camera.updateProjectionMatrix() }
}
function stepExplode(dt: number) {
  if (sepSpring.step(dt) || sepSpring.value !== sepNow) applyExplode(sepSpring.value)
}
function applyExplode(sep: number) {
  sepNow = sep
  if (sep === explodeNow) return
  explodeNow = sep
  const off = offsets(order, sep)
  for (const [name, g] of groups) g.position.z = off.get(name) ?? 0
  groups.get('overlay')!.position.z = off.get('F.SilkS') ?? 0
  // the plating stretches from the bottom copper to the top copper, so the holes stay aligned
  const barrels = groups.get('barrels')
  if (barrels) {
    const zb = slices.get('B.Cu')!.z0, zt = slices.get('F.Cu')!.z1
    const oB = off.get('B.Cu') ?? 0, oF = off.get('F.Cu') ?? 0
    const s = (zt - zb + oF - oB) / (zt - zb)
    barrels.scale.z = s
    barrels.position.z = zb + oB - zb * s
  }
  grid.setZ(gridBaseZ + Math.min(0, off.get('bodies:B') ?? 0))
  updateLabels()
  dirty = true
}
const calloutsOpen = () => sepSpring.target > 0 && sepNow > 0.3
function updateLabels() {
  const open = calloutsOpen()
  const present = open || sepNow > 0.05
  if (!open && hoverLayer.value) setLayerHover(null)
  for (const l of labels) {
    l.on = present && groups.get(l.group)!.visible
    const o = String(calloutOpacity(l.group, hoverLayer.value, open))
    if (l.el.style.opacity !== o) { l.el.style.opacity = o; l.leader.style.opacity = o }
    if (!l.on) l.el.style.display = l.leader.style.display = 'none'
  }
  for (const w of wires) {
    w.outline.visible = w.grid.visible = present
    const k = hoverLayer.value && hoverLayer.value !== w.group ? 0.4 : 1
    for (const l of [w.outline, w.grid]) (l.material as THREE.LineBasicMaterial).opacity = l.userData.opacity * k
  }
  dirty = true
}
// px: the column's gap right of the rightmost anchor, a row, the leader's stop short of the label, the room kept at the pane's edge
const GAP = 24, ROW = 18, STOP = 3, EDGE = 12
const vp = new THREE.Matrix4()
/** Per drawn frame: each shown callout's leader from its layer's rightmost outline point on screen to one column of labels. */
function layoutCallouts() {
  const shown = labels.filter(l => l.on)
  if (!shown.length || !renderer) return
  const el = renderer.domElement, w = el.clientWidth, h = el.clientHeight
  vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
  const live: typeof shown = [], at: P2[] = []
  for (const l of shown) {
    const a = anchor(vp.elements, ring, (groups.get(l.group)?.position.z ?? 0) + l.z, w, h)
    if (!a) { l.el.style.display = l.leader.style.display = 'none'; continue }
    if (l.el.style.display === 'none') l.el.style.display = l.leader.style.display = ''
    live.push(l); at.push(a)
  }
  const placed = column(at, ROW, GAP)
  live.forEach((l, i) => {
    const [lx, ly] = placed[i].label
    l.el.style.transform = `translate(${lx.toFixed(1)}px, ${ly.toFixed(1)}px) translateY(-50%)`
    l.leader.setAttribute('d', leader(placed[i], STOP))
  })
}
function setLayerHover(name: string | null) {
  if (name && !calloutsOpen()) name = null
  if (hoverLayer.value === name) return
  hoverLayer.value = name
  for (const l of labels) l.el.classList.toggle('on', l.group === name)
  updateLabels()
  applyHighlight()
}

function applyVisibility() {
  const hid = props.hidden
  for (const [name, g] of groups) {
    if (/\.(Cu|SilkS|Mask)$/.test(name) || name === 'References') g.visible = !hid.has(name)
  }
  const cu = copperIds(props.board.copper)
  const barrels = groups.get('barrels')
  if (barrels) barrels.visible = cu.some(id => !hid.has(id))
  updateLabels()
  applyHighlight()
}
// inner copper inside an opaque slab is invisible: the slab turns see-through while an inner layer is shown and an outer one hidden
function slabSeeThrough() {
  const hid = props.hidden, cu = copperIds(props.board.copper)
  return cu.length > 2 && cu.slice(1, -1).some(id => !hid.has(id)) && (hid.has('F.Cu') || hid.has('B.Cu'))
}

const toSet = <T,>(v: readonly T[] | Set<T> | null | undefined) => (v instanceof Set ? v : new Set(v ?? []))
const localHover = ref<ItemInfo | null>(null)
const hovered = (i: ItemInfo): Hovered => ({ net: i.net, ref: i.ref, body: i.kind === 'body' })
const scoped = (i: ItemInfo | null) => !!i && inScope(hovered(i), props.scope ?? null)
function focusActive() {
  return fadeOn.value && !!(props.activeNet || props.activeRef || props.selectedRefs?.length || toSet(props.sourceIds).size || props.sourceRefs?.size)
}
// a tint going away is immediate; the fade going away runs its ramp backwards
const levels = new Map<HlState, Tween>(STATES.map(st => [st, new Tween(1, EASE_OUT, st === 'fade' || st === 'dim' || st === 'see' ? 160 : 120)]))
let members = new Map<HlState, string>()
let wasFocus = false, wasSee = false
/** The layer group a mesh sits in, the child of the board group above it. */
function groupOf(m: THREE.Object3D): string | undefined {
  if (m.userData.group !== undefined) return m.userData.group
  let o: THREE.Object3D | null = m
  while (o && o.parent !== boardGroup) o = o.parent
  return (m.userData.group = o?.name)
}
function applyHighlight() {
  if (!variants || !built) return
  const v = variants
  const srcIds = toSet(props.sourceIds), srcRefs = props.sourceRefs ?? new Set<string>()
  const sel = new Set([...(props.activeRef ? [props.activeRef] : []), ...(props.selectedRefs ?? [])])
  const grp = new Set(props.hoverRefs ?? [])
  const net = props.activeNet ?? null
  const hov = localHover.value
  const ghost = !!hov && !scoped(hov)
  const hovSt: HlState = ghost ? 'ghost' : 'hover'
  // another viewer's hover: its items, or the part body it is on
  const far = page.remote?.board === props.board.name ? page.remote.hover : null
  const farIds = new Set(far?.ids ?? []), farBodies = new Set(far && !far.ids.length ? far.refs : [])
  const hovNet = net ? undefined : hov && !ghost && hov.kind !== 'body' && hov.net ? hov.net : props.hoverNet ?? undefined
  const pinned = netRoles(props.board, net), lit = netRoles(props.board, hovNet)
  const focus = focusActive()
  const clear = translucent({ net, ref: props.activeRef, refs: props.selectedRefs }, fadeOn.value)
  const layer = hoverLayer.value
  const fade = levels.get('fade')!, dim = levels.get('dim')!, seeT = levels.get('see')!
  const now = performance.now()
  if (focus && !wasFocus) { fade.snap(0); dim.snap(0) }
  fade.set(focus ? 1 : 0, now); dim.set(focus ? 1 : 0, now)
  wasFocus = focus
  const see = !!layer
  if (see && !wasSee) seeT.snap(0)
  seeT.set(see ? 1 : 0, now)
  wasSee = see
  // while the fade runs out, faded meshes stay faded at a falling level
  const fading = !focus && fade.value > 0, clearing = !see && seeT.value > 0
  // the look holds while the fade runs out, so the faded meshes leave as they were drawn
  v.setLook(focus || (fading && !slabSeeThrough()) ? look : null)
  const keep = (m: THREE.Mesh, st: HlState | null): HlState | null =>
    st === null && ((fading && (m.userData.hl === 'fade' || m.userData.hl === 'dim')) || (clearing && m.userData.hl === 'see')) ? m.userData.hl : st
  const seen = new Map<HlState, number[]>()
  const put = (m: THREE.Mesh, st: HlState | null, id: number) => {
    st = keep(m, st)
    if (st && st !== 'fade' && st !== 'dim' && st !== 'ghost') { let l = seen.get(st); if (!l) seen.set(st, l = []); l.push(id) }
    setState(m, st, v)
  }
  for (const m of built.meshes) {
    const u = m.userData as ItemInfo
    const pad = u.kind === 'pad'
    let st: HlState | null =
      srcIds.has(u.id) || (pad && u.ref && srcRefs.has(u.ref)) ? 'src'
      : pad && u.ref && sel.has(u.ref) ? 'sel'
      : u.net && pinned.get(u.net) === 'primary' ? 'net'
      : u.net && pinned.has(u.net) ? 'mate'
      : hov && hov.kind !== 'body' && hov.id === u.id ? hovSt
      : farIds.has(u.id) ? 'hover'
      : u.net && lit.get(u.net) === 'primary' ? 'hover'
      : u.net && lit.has(u.net) ? 'mate'
      : pad && u.ref && grp.has(u.ref) ? 'group'
      : null
    if (!st && focus && !(u.ref && (sel.has(u.ref) || srcRefs.has(u.ref)))) st = 'fade'
    if (layerDimmed(groupOf(m), layer)) st = 'see'
    put(m, st, u.id)
  }
  // parts touching the active net or its pair group stay in focus
  const netRefs = new Set<string>()
  if (net) for (const fp of props.board.footprints) if (fp.pads.some(p => p.net && pinned.has(p.net))) netRefs.add(fp.ref)
  let i = 0
  for (const [ref, meshes] of bodyMeshes) {
    i--
    let st: HlState | null = srcRefs.has(ref) ? 'src' : sel.has(ref) ? 'sel' : hov?.kind === 'body' && hov.ref === ref ? hovSt : farBodies.has(ref) ? 'hover' : grp.has(ref) ? 'group' : null
    if (!st && focus && !netRefs.has(ref)) st = 'fade'
    for (const m of meshes) put(m, layerDimmed(groupOf(m), layer) ? 'see' : st, i)
  }
  const inner = slabSeeThrough()
  for (const m of slabMeshes) setState(m, keep(m, slabState({ inner, translucent: clear, dimmed: layerDimmed(groupOf(m), layer), focus })), v)
  for (const m of maskMeshes) setState(m, keep(m, slabState({ inner: false, translucent: clear, dimmed: layerDimmed(groupOf(m), layer), focus })), v)
  if (inner) { fade.snap(1); v.setLevel('fade', 1) }
  // a tint whose members changed ramps in again from nothing
  const next = new Map<HlState, string>()
  for (const [st, ids] of seen) {
    const sig = ids.join()
    next.set(st, sig)
    if (members.get(st) !== sig) { const t = levels.get(st)!; t.snap(0); t.set(1, now) }
  }
  members = next
  updateLabels()
  dirty = true
}
/** Per frame: advance the level tweens; true while any is moving. */
function stepLevels(now: number): boolean {
  if (!variants) return false
  let busy = false
  for (const [st, t] of levels) {
    const moving = t.step(now)
    variants.setLevel(st, t.value)
    busy ||= moving
  }
  // the fade has run out: drop the faded states it was holding
  if (!busy && ((!wasFocus && built?.meshes.some(m => m.userData.hl === 'fade' || m.userData.hl === 'dim')) || (!wasSee && [...slabMeshes, ...maskMeshes, ...(built?.meshes ?? [])].some(m => m.userData.hl === 'see')))) applyHighlight()
  return busy
}

/** The board, its parts and references, at the separation the explode is heading for; never the grid. */
function bounds(): THREE.Box3 {
  const box = boardGroup ? stackBox(boardGroup, offsets(order, sepTarget())) : new THREE.Box3()
  if (!box.isEmpty()) return box
  const bb = props.board.bbox
  return new THREE.Box3(new THREE.Vector3(bb.x, -(bb.y + bb.h), 0), new THREE.Vector3(bb.x + bb.w, -bb.y, props.board.thickness))
}

// critically damped: a move settles in about 350 ms and a new preset retargets mid-flight
const CAM = { response: 0.28, damping: 1 }
const cam = { tx: new Spring(0, CAM), ty: new Spring(0, CAM), tz: new Spring(0, CAM), r: new Spring(1, CAM), polar: new Spring(0, CAM), azimuth: new Spring(0, CAM) }
let camMoving = false
const stackFit = new StackFit()
function spherical(off: THREE.Vector3) { const r = off.length() || 1; return { r, polar: Math.acos(Math.max(-1, Math.min(1, off.z / r))), azimuth: Math.atan2(off.y, off.x) } }
function moveCamera(centre: THREE.Vector3, dir: THREE.Vector3, dist: number, near: number, far: number, instant = false) {
  stackFit.stop()
  const now = spherical(camera.position.clone().sub(controls.target)), to = spherical(dir.clone().multiplyScalar(dist))
  if (instant || !fitted) {
    controls.target.copy(centre)
    camera.position.copy(centre).addScaledVector(dir, dist)
    camMoving = false
    camera.near = near; camera.far = far
  } else {
    if (!camMoving) {
      cam.tx.snap(controls.target.x); cam.ty.snap(controls.target.y); cam.tz.snap(controls.target.z)
      cam.r.snap(now.r); cam.polar.snap(now.polar); cam.azimuth.snap(now.azimuth)
    }
    // the shorter way round
    let az = to.azimuth
    while (az - cam.azimuth.value > Math.PI) az -= 2 * Math.PI
    while (az - cam.azimuth.value < -Math.PI) az += 2 * Math.PI
    cam.tx.set(centre.x); cam.ty.set(centre.y); cam.tz.set(centre.z)
    cam.r.set(to.r); cam.polar.set(to.polar); cam.azimuth.set(az)
    camMoving = true
  }
  if (camMoving) { camera.near = Math.min(near, camera.near); camera.far = Math.max(far, camera.far); camNearFar = [near, far] }
  camera.updateProjectionMatrix()
  controls.update()
  dirty = true
}
let camNearFar: [number, number] | null = null
function stepCamera(dt: number) {
  if (!camMoving) return
  let busy = false
  for (const s of Object.values(cam)) busy = s.step(dt) || busy
  controls.target.set(cam.tx.value, cam.ty.value, cam.tz.value)
  const r = cam.r.value, p = cam.polar.value, a = cam.azimuth.value
  camera.position.set(controls.target.x + r * Math.sin(p) * Math.cos(a), controls.target.y + r * Math.sin(p) * Math.sin(a), controls.target.z + r * Math.cos(p))
  dirty = true
  if (!busy) {
    camMoving = false
    if (camNearFar) { camera.near = camNearFar[0]; camera.far = camNearFar[1]; camera.updateProjectionMatrix() }
  }
}

/** The share of the pane's width the callout column takes, from its longest label; none while the stack is closed. */
function columnShare(): number {
  const w = renderer?.domElement.clientWidth ?? 0
  const shown = labels.filter(l => groups.get(l.group)?.visible)
  if (!w || !shown.length || sepTarget() === 0) return 0
  // a label not yet laid out is measured once by hand, or guessed from its text in the 11 px mono face
  const width = (l: (typeof labels)[number]) => {
    if (!l.width) { const d = l.el.style.display; l.el.style.display = ''; l.width = l.el.offsetWidth; l.el.style.display = d }
    return l.width || (l.el.textContent ?? '').length * 6.6 + 8
  }
  return (GAP + Math.max(...shown.map(width)) + EDGE) / w
}

/** The target and distance that frame bounds() along `dir`, the callout column beside it when exploded. */
function frame(dir: THREE.Vector3) {
  const box = bounds(), vfov = (camera.fov * Math.PI) / 180
  fitRadius = fitSphere(box)!.radius
  const centre = box.getCenter(new THREE.Vector3()), share = columnShare()
  if (!share) return { centre, dist: fitDistance(box, dir, camera.up, vfov, camera.aspect) }
  const { dist, shift } = fitBeside(box, dir, camera.up, vfov, camera.aspect, share)
  return { centre: centre.add(shift), dist }
}

function view(kind: 'fit' | 'top' | 'bottom' | 'iso') {
  if (!camera) return
  let dir: THREE.Vector3
  if (kind === 'fit') dir = camera.position.clone().sub(controls.target).normalize()
  // the tiny y offsets pick screen-up at the poles: north up from above, back text left to right from below
  else if (kind === 'top') dir = new THREE.Vector3(0, -1e-3, 1)
  else if (kind === 'bottom') dir = new THREE.Vector3(0, 1e-3, -1)
  else dir = new THREE.Vector3(...ISO_DIR)
  if (!isFinite(dir.x) || dir.lengthSq() === 0) dir = new THREE.Vector3(...ISO_DIR)
  dir.normalize()
  const { centre, dist } = frame(dir)
  moveCamera(centre, dir, dist, Math.max(0.05, dist / 200), dist * 20)
}

const firstView = (): 'bottom' | 'iso' => (props.fromBelow ? 'bottom' : 'iso')

/** Frame frameRef; the move is instant until the first fit is done. */
function frameNow() {
  const fp = props.frameRef ? props.board.footprints.find(f => f.ref === props.frameRef) : undefined
  if (!fp) return false
  return focus(fp.ref, props.fromBelow ? FOCUS_BELOW : undefined, Math.max(fp.body.w, fp.body.h, fp.height, 2) * 5 + 10)
}

/** Frame one part: the camera at `dist` mm from its body centre along `dir` (three axes, z up). */
function focus(ref: string, dir: [number, number, number] = FOCUS_DIR, dist = 6) {
  const fp = props.board.footprints.find(f => f.ref === ref)
  if (!fp || !camera) return false
  const z = fp.side === 'B' ? -fp.height / 2 : props.board.thickness + fp.height / 2
  const centre = new THREE.Vector3(fp.body.x, -fp.body.y, z)
  const d = new THREE.Vector3(...dir).normalize()
  if (Math.abs(d.z) > 0.999) d.y += d.z > 0 ? -1e-3 : 1e-3
  moveCamera(centre, d.normalize(), dist, Math.max(0.01, dist / 200), dist * 200)
  return true
}

let buildMs = 0, firstFrameAt = 0, buildStart = 0, geometryMs = 0
// page time when the first board was whole
let completeAt = 0
// each batch as it lands: ms after the build started, jobs, kind, ms spent adding it
const landings: [number, number, string, number][] = []
const deltas: number[] = [], renders: number[] = []
let lastFrame = 0
function stats() {
  const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0)
  const p95 = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length * 0.95)] : 0)
  return { frames: deltas.length, avgFrameMs: +avg(deltas).toFixed(2), p95FrameMs: +p95(deltas).toFixed(2), avgRenderMs: +avg(renders).toFixed(2), buildMs: +buildMs.toFixed(1), geometryMs: +geometryMs.toFixed(0), landings: [...landings], workers: [...pool.log], firstFrameAt: +firstFrameAt.toFixed(0), completeAt: +completeAt.toFixed(0),
    meshes: built?.meshes.length ?? 0, geometries: geoCache.size, calls: renderer?.info.render.calls ?? 0, triangles: renderer?.info.render.triangles ?? 0 }
}
/** Orbit the camera once around its target over `frames` frames, rendering each, and report the timings. */
function bench(frames = 240): Promise<ReturnType<typeof stats>> {
  deltas.length = 0; renders.length = 0
  const off = camera.position.clone().sub(controls.target)
  let i = 0
  return new Promise(resolve => {
    const step = () => {
      if (i++ >= frames) { resolve(stats()); return }
      off.applyAxisAngle(new THREE.Vector3(0, 0, 1), (Math.PI * 2) / frames)
      camera.position.copy(controls.target).add(off)
      camera.lookAt(controls.target)
      dirty = true
      requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  })
}
defineExpose({ view, focus, stats, bench })

let fitRadius = 50
/** Screen pixels per mm at the camera's target. */
function pxPerMm() {
  const d = camera.position.distanceTo(controls.target) || 1
  return (renderer?.domElement.clientHeight ?? 800) / (2 * d * Math.tan((camera.fov * Math.PI) / 360))
}

// the fog starts past the far side of the board, so it only fades the grid into the canvas
function stepFog() {
  const fog = scene.fog as THREE.Fog | null
  if (!fog) return
  const d = camera.position.distanceTo(controls.target)
  fog.near = d + fitRadius * 1.5
  fog.far = d + fitRadius * 6
}

function applyTheme() {
  if (!scene || !host.value) return
  const css = getComputedStyle(host.value)
  const token = (k: string) => css.getPropertyValue(k).trim()
  let bg: THREE.Color
  try { bg = new THREE.Color(token('--canvas') || '#0e1013') } catch { bg = new THREE.Color('#0e1013') }
  scene.background = bg
  scene.fog = new THREE.Fog(bg, 1e5, 2e5)
  grid.setTones({ minor: token('--grid-minor'), major: token('--grid-major'), origin: token('--grid-origin') })
  variants?.dispose()
  applyHighlight()
  dirty = true
}

function resize() {
  const el = host.value
  if (!el || !renderer) return
  const w = Math.max(1, el.clientWidth), h = Math.max(1, el.clientHeight)
  renderer.setSize(w, h, false)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  dirty = true
}

function loop(now: number) {
  raf = requestAnimationFrame(loop)
  // at most two frames per step, so the springs never jump after a long gap or a hidden tab
  const dt = lastFrame ? Math.min(now - lastFrame, 34) / 1000 : 0
  if (import.meta.env.DEV && lastFrame) { deltas.push(now - lastFrame); if (deltas.length > 600) deltas.shift() }
  lastFrame = now
  stepExplode(dt)
  stepStackFit()
  stepCamera(dt)
  stepFog()
  if (stepLevels(now)) dirty = true
  const moved = controls.update()
  if (grid.update(camera, pxPerMm())) dirty = true
  stepWires()
  const changed = dirty
  if ((moved || dirty) && renderer) {
    const t = performance.now()
    renderer.render(scene, camera)
    layoutCallouts()
    if (import.meta.env.DEV) { renders.push(performance.now() - t); if (renders.length > 600) renders.shift(); if (!firstFrameAt && boardGroup) firstFrameAt = performance.now() }
    dirty = false
  }
  // ready: drawn and still; the mark goes on the frame after it
  if (!readySent && complete && boardGroup && !moved && !changed && !camMoving && !stackFit.active && sepSpring.settled) {
    readySent = true
    const my = gen
    requestAnimationFrame(() => { if (my === gen && readySent && alive) setReady('3d') })
  }
}

const RANK: Record<string, number> = { body: 0, pad: 1, via: 2, track: 3, graphic: 4, text: 5, zone: 6 }
function shown(o: THREE.Object3D | null): boolean {
  for (; o; o = o.parent) if (!o.visible) return false
  return true
}
function pick(e: PointerEvent): { info: ItemInfo | null; ref?: string; group?: string } | null {
  const el = renderer!.domElement, r = el.getBoundingClientRect()
  pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
  raycaster.setFromCamera(pointer, camera)
  const hits = raycaster.intersectObject(boardGroup!, true).filter(h => h.object.userData.pick !== false && shown(h.object))
  if (!hits.length) return null
  const group = groupOf(hits[0].object)
  // the nearest, unless a hit within a hair ranks higher: a pad over its zone
  const near = hits.filter(h => h.distance <= hits[0].distance + 0.02)
  let best: { info: ItemInfo | null; ref?: string; rank: number } | null = null
  for (const h of near) {
    let o: THREE.Object3D | null = h.object
    if (o.userData.pick === 'slab') { if (!best) best = { info: null, rank: 99 }; continue }
    let cand: { info: ItemInfo | null; ref?: string; rank: number } | null = null
    if (o.userData.id !== undefined) cand = { info: o.userData as ItemInfo, ref: o.userData.ref, rank: RANK[o.userData.kind] ?? 9 }
    else {
      while (o && !o.userData.ref) o = o.parent
      if (o) cand = { info: { id: -1, kind: 'body', ref: o.userData.ref, layers: [], layer: '' }, ref: o.userData.ref, rank: 0 }
    }
    if (cand && (!best || cand.rank < best.rank)) best = cand
  }
  return best && best.info ? { ...best, group } : { info: null, group }
}
const asPicked = (i: ItemInfo): Picked => (i.kind === 'body' ? { ref: i.ref, id: null, kind: 'body' } : { ...(i.ref ? { ref: i.ref } : {}), id: i.id, kind: i.kind, ...(i.net ? { net: i.net } : {}) })
function setHover(info: ItemInfo | null) {
  const prev = localHover.value
  if (prev === info || (prev && info && prev.id === info.id && prev.layer === info.layer && prev.ref === info.ref)) return
  localHover.value = info
  page.hoverItem = !info ? null : info.kind === 'body' ? { ids: [], refs: [info.ref!], net: null } : { ids: [info.id], refs: info.ref ? [info.ref] : [], net: info.net ?? null }
  // outside the focus the hover stays here: no net or part reaches the other views
  const out = scoped(info) ? info : null
  emit('hover', out ? { ...asPicked(out), layer: out.layer } : null)
  const was = scoped(prev) ? prev?.net ?? null : null
  if (was !== (out?.net ?? null)) emit('net', out?.net ?? null)
  applyHighlight()
}
function onMove(e: PointerEvent) {
  if (e.buttons) { hover.value = null; setHover(null); setLayerHover(null); return }
  const p = pick(e)
  const r = host.value!.getBoundingClientRect()
  const x = e.clientX - r.left, y = e.clientY - r.top
  const info = p?.info ?? null
  const layer = p?.group && labels.some(l => l.group === p.group) && (!props.scope || scoped(info)) ? p.group : null
  setLayerHover(layer)
  setHover(info)
  if (!info) { hover.value = null; renderer!.domElement.style.cursor = ''; return }
  if (info.kind === 'body') {
    const fp = props.board.footprints.find(f => f.ref === info.ref)!
    hover.value = { title: fp.ref, value: fp.value, detail: [describe(fp.model, { value: fp.value, fields: fp.fields ?? {} }), fp.side === 'B' ? 'back' : 'front'].filter(Boolean).join(', '), x, y, item: info, ref: fp.ref }
  } else {
    const title = info.ref ? `${info.ref}${info.pad ? '.' + info.pad : ''}` : info.net ?? info.kind
    const route = info.kind === 'track' ? routeHover(props.board, info) : null
    const detail = route ? `${route.startsWith(`${info.net}, `) ? route.slice(info.net!.length + 2) : route}, ${info.layer}` : `${info.kind} on ${info.layer}`
    hover.value = { title, value: info.ref ? info.net ?? '' : '', detail, x, y, item: info, ref: info.ref }
  }
  renderer!.domElement.style.cursor = 'pointer'
}
function onDown(e: PointerEvent) { downAt = [e.clientX, e.clientY] }
function onUp(e: PointerEvent) {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4) { downAt = null; return }
  downAt = null
  const info = pick(e)?.info ?? null
  const act = clickOf(e)
  if (act.select) emit('select', info ? asPicked(info) : null)
  if (act.open && info) emit('open', info.ref ?? '', act.open, { ...asPicked(info), meta: e.metaKey, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey })
}
function onLeave() { hover.value = null; setHover(null); setLayerHover(null) }
onBeforeUnmount(() => { page.hoverItem = null })

watch(() => page.grid, on => { grid.on = on; dirty = true })
function toggleFade() { ui.fade = !ui.fade; if (props.fade === undefined) store.set('pcbjs.3d.fade', ui.fade ? '1' : '0'); emit('update:fade', ui.fade) }
function setLook(k: keyof typeof look, v: number | boolean) {
  (look as Record<string, number | boolean>)[k] = v
  store.set(`pcbjs.3d.look.${k}`, String(v))
}
const onOpacity = (e: Event) => setLook('opacity', Math.max(0.05, Math.min(1, +(e.target as HTMLInputElement).value)))
function toggleExplode() { ui.explode = !ui.explode; emit('update:explode', ui.explode) }
function onSeparation(e: Event) {
  stackFit.stop()
  ui.separation = Math.max(0, Math.min(15, +(e.target as HTMLInputElement).value))
  if (props.separation === undefined) store.set('pcbjs.3d.separation', String(ui.separation))
  emit('update:separation', ui.separation)
}

onMounted(() => {
  const el = host.value!
  if (props.fade === undefined && store.get('pcbjs.3d.fade') === '0') ui.fade = false
  const op = Number(store.get('pcbjs.3d.look.opacity'))
  if (store.get('pcbjs.3d.look.opacity') !== null && isFinite(op)) look.opacity = Math.max(0.05, Math.min(1, op))
  for (const k of ['mono', 'edges', 'grouped'] as const) { const v = store.get(`pcbjs.3d.look.${k}`); if (v !== null) look[k] = v === 'true' }
  const sep = Number(store.get('pcbjs.3d.separation'))
  if (props.separation === undefined && store.get('pcbjs.3d.separation') !== null && isFinite(sep)) ui.separation = Math.max(0, Math.min(15, sep))
  grid.on = page.grid
  renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
  renderer.domElement.className = 'view3d-canvas'
  el.prepend(renderer.domElement)
  callLayer = document.createElement('div')
  callLayer.className = 'view3d-labels'
  leaders = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  leaders.classList.add('view3d-leaders')
  callLayer.append(leaders)
  renderer.domElement.after(callLayer)
  scene = new THREE.Scene()
  scene.add(grid.root)
  camera = new THREE.PerspectiveCamera(35, 1, 0.1, 10000)
  camera.up.set(0, 0, 1)
  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.12
  controls.addEventListener('change', () => { dirty = true })
  // the user takes the camera: a preset move in flight stops where it is
  controls.addEventListener('start', () => { camMoving = false; stackFit.stop() })
  // a soft room for the metal parts to reflect; the lights below do the shaping
  const pmrem = new THREE.PMREMGenerator(renderer)
  envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  pmrem.dispose()
  scene.environment = envMap
  scene.environmentIntensity = 0.35
  scene.add(new THREE.HemisphereLight('#ffffff', '#3a3a3a', 1.4))
  // the sun from the front left, so its glint in the glossy mask stays out of the preset views, see ./scene/lights
  const sun = new THREE.DirectionalLight('#ffffff', 1.8)
  sun.position.set(...SUN)
  scene.add(sun)
  const under = new THREE.DirectionalLight('#ffffff', 0.6)
  under.position.set(...UNDER)
  scene.add(under)
  variants = new Variants(cssColor)
  applyTheme()
  resize()
  ro = new ResizeObserver(resize)
  ro.observe(el)
  mo = new MutationObserver(applyTheme)
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] })
  mq = window.matchMedia('(prefers-color-scheme: dark)')
  mq.addEventListener('change', applyTheme)
  const c = renderer.domElement
  c.addEventListener('pointermove', onMove)
  c.addEventListener('pointerdown', onDown)
  c.addEventListener('pointerup', onUp)
  c.addEventListener('pointerleave', onLeave)
  buildBoard()
  markPoints()
  // opened exploded, as ?explode= asks: the camera frames the open stack
  if (ui.explode) { sepSpring.snap(sepTarget()); applyExplode(sepSpring.value); boardGroup?.updateMatrixWorld(true); fitted = false; view(firstView()); frameNow(); fitted = true }
  raf = requestAnimationFrame(loop)
})

watch(() => props.board, () => { localHover.value = null; hover.value = null; buildBoard() })
watch(() => [...props.hidden].join('|'), applyVisibility)
watch(() => props.frameRef, () => { if (fitted) frameNow() })
watch(() => props.fromBelow, () => { if (fitted && !frameNow()) view(firstView()) })
watch(() => [props.activeNet, props.hoverNet, props.activeRef, props.sourceRefs, props.sourceIds, (props.selectedRefs ?? []).join(), (props.hoverRefs ?? []).join(), fadeOn.value, props.scope, page.remote], applyHighlight)
watch(() => [props.sourcePoints, props.board], markPoints, { flush: 'post' })
watch(() => props.fade, v => { if (v !== undefined && v !== ui.fade) ui.fade = v })
watch(() => props.explode, v => { if (v !== undefined && v !== ui.explode) ui.explode = v })
watch(() => props.separation, v => { if (v !== undefined && v !== ui.separation) ui.separation = v })
watch(() => ui.explode, onExplode)
watch(look, applyHighlight)
watch(() => ui.separation, () => { if (ui.explode) startExplode() })

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  alive = false
  ro?.disconnect(); mo?.disconnect(); mq?.removeEventListener('change', applyTheme)
  controls?.dispose()
  for (const d of disposables) d.dispose()
  disposables = []
  pool.dispose()
  geoCache.dispose()
  grid.clear()
  variants?.dispose(); variants = null
  envMap?.dispose(); envMap = null
  callLayer?.remove(); callLayer = leaders = null
  if (renderer) { renderer.dispose(); renderer.domElement.remove(); renderer = null }
})
</script>

<template>
  <div ref="host" class="view3d">
    <div class="view3d-buttons">
      <button class="icon" title="Fit (whole board)" aria-label="Fit" @click="view('fit')"><svg viewBox="0 0 16 16"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" /></svg></button>
      <button class="icon" title="Top view" aria-label="Top view" @click="view('top')"><svg viewBox="0 0 16 16"><rect x="3" y="7" width="10" height="6" rx="1" /><path d="M8 1.5v4M6 3.8L8 5.8l2-2" /></svg></button>
      <button class="icon" title="Bottom view" aria-label="Bottom view" @click="view('bottom')"><svg viewBox="0 0 16 16"><rect x="3" y="3" width="10" height="6" rx="1" /><path d="M8 14.5v-4M6 12.2L8 10.2l2 2" /></svg></button>
      <button class="icon" title="Iso view" aria-label="Iso view" @click="view('iso')"><svg viewBox="0 0 16 16"><path d="M8 2l5.5 3v6L8 14l-5.5-3V5zM8 8l5.5-3M8 8v6M8 8L2.5 5" /></svg></button>
      <span class="view3d-sep"></span>
      <button class="icon" :class="{ on: page.grid }" :aria-pressed="page.grid" title="Millimetre grid" aria-label="Grid" @click="toggleGrid"><svg viewBox="0 0 16 16"><path d="M2 5.5h12M2 10.5h12M5.5 2v12M10.5 2v12" /></svg></button>
      <span class="view3d-anchor">
        <button class="icon" :class="{ on: ui.fade }" :aria-pressed="ui.fade" title="Focus fade: dim everything but the selection, the net and the source highlight" aria-label="Focus fade" @click="toggleFade"><svg viewBox="0 0 16 16"><circle cx="6" cy="8" r="4" /><circle cx="10.5" cy="8" r="4" stroke-dasharray="1.5 1.5" /></svg></button>
        <span v-if="focusOn" class="view3d-pop view3d-look" :class="{ low: ui.explode }">
          <span class="view3d-row">
            <input class="view3d-range" type="range" min="0.05" max="1" step="0.05" :value="look.opacity" :title="`Out of focus at ${Math.round(look.opacity * 100)}% opacity`" aria-label="Opacity out of focus" @input="onOpacity" />
            <span class="view3d-val">{{ Math.round(look.opacity * 100) }}%</span>
            <button class="icon" :class="{ on: look.mono }" :aria-pressed="look.mono" title="Monochrome: grey out everything out of focus" aria-label="Monochrome" @click="setLook('mono', !look.mono)"><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" /><path d="M8 2.5v11a5.5 5.5 0 0 0 0-11z" fill="currentColor" /></svg></button>
          </span>
          <span class="view3d-row">
            <span class="view3d-seg" role="group" aria-label="Out of focus drawn as">
              <button :class="{ on: !look.edges }" :aria-pressed="!look.edges" title="Shaded faces" @click="setLook('edges', false)">Shaded</button>
              <button :class="{ on: look.edges }" :aria-pressed="look.edges" title="Edges only, no faces" @click="setLook('edges', true)">Edges</button>
            </span>
            <span class="view3d-seg" role="group" aria-label="Transparency">
              <button :class="{ on: look.grouped }" :aria-pressed="look.grouped" title="Grouped: one body, its hidden faces stay hidden" @click="setLook('grouped', true)">Grouped</button>
              <button :class="{ on: !look.grouped }" :aria-pressed="!look.grouped" title="Stacked: every surface shows through" @click="setLook('grouped', false)">Stacked</button>
            </span>
          </span>
        </span>
      </span>
      <span class="view3d-anchor">
        <button class="icon" :class="{ on: ui.explode }" :aria-pressed="ui.explode" title="Explode the layers" aria-label="Explode" @click="toggleExplode"><svg viewBox="0 0 16 16"><path d="M2.5 3.5l5.5-2 5.5 2-5.5 2zM2.5 8.5l5.5-2 5.5 2-5.5 2zM2.5 13l5.5-2 5.5 2" /></svg></button>
        <span v-if="ui.explode" class="view3d-pop"><input class="view3d-range" type="range" min="0" max="15" step="0.5" :value="ui.separation" :title="`${ui.separation} mm between layers`" aria-label="Layer separation in mm" @input="onSeparation" /></span>
      </span>
    </div>
    <div v-if="hover" class="view3d-tip" :style="{ left: hover.x + 12 + 'px', top: hover.y + 12 + 'px' }">
      <b>{{ hover.title }}</b> {{ hover.value }}<span v-if="hover.detail" class="view3d-detail"> · {{ hover.detail }}</span>
      <div v-if="hoverSrc" class="view3d-src">{{ hoverSrc }}</div>
      <div v-if="src.meta" class="view3d-hint">{{ linkHint }}</div>
    </div>
  </div>
</template>

<style scoped>
.view3d { position: relative; width: 100%; height: 100%; min-height: 0; overflow: hidden; background: var(--canvas, #0e1013); }
.view3d :deep(.view3d-canvas) { display: block; width: 100%; height: 100%; outline: none; touch-action: none; }
.view3d :deep(.view3d-labels) { position: absolute; inset: 0; pointer-events: none; }
.view3d-buttons { position: absolute; top: 8px; right: 8px; display: flex; gap: 4px; align-items: center; z-index: 1; }
.view3d-buttons button { display: grid; place-items: center; width: 26px; height: 26px; padding: 0; border-radius: 4px; cursor: pointer; color: var(--fg, #e6e8ee); background: var(--panel, #1b1f27); border: 1px solid var(--line, #2b3140); }
.view3d-buttons svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.3; stroke-linecap: round; stroke-linejoin: round; }
.view3d :deep(.view3d-callout) { font: 11px/1 var(--mono, ui-monospace, monospace); color: color-mix(in srgb, var(--c, var(--fg)) 60%, var(--fg, #e6e8ee)); white-space: nowrap; pointer-events: auto; cursor: default;
  text-shadow: 0 0 3px var(--bg, #14171d), 0 0 2px var(--bg, #14171d); opacity: 0; transition: opacity 140ms cubic-bezier(0.25, 0.1, 0.25, 1); }
.view3d :deep(.view3d-callout) { position: absolute; left: 0; top: 0; padding: 2px 4px; border-radius: 4px; will-change: transform; }
.view3d :deep(.view3d-callout.on) { background: color-mix(in srgb, var(--panel, #1b1f27) 85%, transparent); }
.view3d :deep(.view3d-leaders) { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.view3d :deep(.view3d-leaders path) { fill: none; stroke: color-mix(in srgb, var(--c, var(--dim)) 60%, var(--fg, #e6e8ee)); stroke-width: 1; transition: opacity 140ms cubic-bezier(0.25, 0.1, 0.25, 1); }
.view3d-buttons button { transition: color 120ms cubic-bezier(0.25, 0.1, 0.25, 1), border-color 120ms cubic-bezier(0.25, 0.1, 0.25, 1), background-color 120ms cubic-bezier(0.25, 0.1, 0.25, 1); }
.view3d-buttons button:hover { border-color: var(--accent, #7cc4ff); }
.view3d-buttons button.on { color: var(--accent, #7cc4ff); border-color: var(--accent, #7cc4ff); }
.view3d-sep { width: 6px; }
.view3d-anchor { position: relative; display: grid; }
/* hangs under the explode button, out of the row's flow, so no button moves when it opens */
.view3d-pop { position: absolute; top: calc(100% + 4px); right: 0; display: flex; align-items: center; height: 26px; padding: 0 6px; border-radius: 4px; background: var(--panel, #1b1f27); border: 1px solid var(--line, #2b3140); box-sizing: border-box; }
.view3d-range { width: 90px; margin: 0; accent-color: var(--accent, #7cc4ff); }
.view3d-look { flex-direction: column; align-items: stretch; gap: 4px; height: auto; padding: 4px 6px; }
/* below the explode popover when both are open */
.view3d-look.low { top: calc(100% + 34px); }
.view3d-row { display: flex; align-items: center; gap: 6px; justify-content: space-between; }
.view3d-val { width: 30px; font: 11px/1 var(--mono, ui-monospace, monospace); color: var(--dim, #8b93a1); text-align: right; }
.view3d-seg { display: flex; }
.view3d-buttons .view3d-seg button { width: auto; height: 20px; padding: 0 6px; font: 11px/1 var(--sans, system-ui, sans-serif); border-radius: 0; }
.view3d-buttons .view3d-seg button:first-child { border-radius: 4px 0 0 4px; }
.view3d-buttons .view3d-seg button:last-child { border-radius: 0 4px 4px 0; margin-left: -1px; }
.view3d-detail { opacity: 0.75; }
.view3d-src { font-family: var(--mono); color: var(--accent); }
.view3d-hint { color: var(--dim); font-size: 11px; }
.view3d-tip { position: absolute; z-index: 2; pointer-events: none; font-size: 12px; padding: 3px 7px; border-radius: 4px; white-space: nowrap; color: var(--fg, #e6e8ee); background: var(--panel, #1b1f27); border: 1px solid var(--line, #2b3140); }
</style>
