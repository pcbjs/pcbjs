// The render spec on the renderer's options for the board GLB: presets as fit cameras, highlight and dim as styles, layers as
// visibility on the stack group nodes, explode as node translations from the extras, marks as annotations at a layer's elevation.
import type { Annotation, Bounds, Camera, FitCamera, RenderOptions, RenderStyle } from '@pcbjs/renderer'
import type { SiteData } from '@pcbjs/core/site-data'
import { flagLayer } from '@pcbjs/core/internal/layers'
import { copperSlices, maskThickness, sliceOf } from '@pcbjs/export/internal/scene/stack'
import type { GlbScene } from './glb.js'
import { meshed } from './glb.js'
import type { Box, Target } from './targets.js'
import { THEME_COLORS, type Mark, type Preset, type RenderSpec, type Theme } from './spec.js'
import { LABEL_OFFSET, labelImage, rgba } from './marks.js'

type Vec3 = [number, number, number]

/** What the worker frames: the union of the nodes', the selections' and the box's bounds, grown by `margin` metres. */
export interface FrameRequest {
  camera: FitCamera
  nodes: number[]
  selections: string[]
  bounds: Bounds | null
  margin: number
}

export interface Shot3d {
  options: RenderOptions
  frame: FrameRequest | null
}

/** Preset directions from the target toward the camera and the image up, in GLB space: x right, y up, z toward the board's bottom edge. */
const PRESET_CAMERAS: Record<Preset, { direction: Vec3; up: Vec3; projection: 'perspective' | 'orthographic' }> = {
  iso: { direction: [0.55, 0.9, 0.95], up: [0, 1, 0], projection: 'perspective' },
  top: { direction: [0, 1, 0], up: [0, 0, -1], projection: 'orthographic' },
  bottom: { direction: [0, -1, 0], up: [0, 0, 1], projection: 'orthographic' },
  front: { direction: [0, 0.25, 1], up: [0, 1, 0], projection: 'perspective' },
}
/** the fit's multiplicative margin around the whole board */
const FIT_MARGIN = 1.04
/** how far the rest is tinted toward the canvas at full dim */
const FADE = 0.75
/** the alpha of a selection outline where the board hides it */
export const OCCLUDED_ALPHA = 0.35
/** the tint over a selected target, the renderer's stand-in for the viewer's rim */
const SEL_TINT = 0.15
/** m above a surface a depth-tested mark still shows through: mask and silk */
const MARK_BIAS = 3e-4

/** Board mm to GLB metres. */
export const toWorld = (x: number, y: number, z: number): Vec3 => [x / 1000, z / 1000, y / 1000]

/** The board turned over left to right, about its y axis, as KiCad flips it, so back silk reads correctly. */
const turned = (v: Vec3): Vec3 => [-v[0], -v[1], v[2]]

/** The fit camera of a preset seen from a side. */
export function presetCamera(p: Preset, side: 'F' | 'B' = 'F'): FitCamera {
  const c = PRESET_CAMERAS[p]
  const b = side === 'B'
  return { type: 'fit', direction: b ? turned(c.direction) : c.direction, up: b ? turned(c.up) : c.up, projection: c.projection, fov: 30, margin: FIT_MARGIN }
}

/** The direction toward the camera, for which side faces it. */
function viewDir(cam: Camera): Vec3 {
  if (cam.type === 'fit') return cam.direction ?? [1, 1, 1]
  if (cam.type === 'perspective' || cam.type === 'orthographic') return [0, 1, 2].map(i => cam.position[i] - cam.target[i]) as Vec3
  if (cam.type === 'resolved') return cam.state.forward.map(v => -v) as Vec3
  return [0, 1, 0]
}

/** The stack groups a name means: a group word, a layer id or alias, or a node name of the GLB. */
export function groupNodes(name: string, scene: GlbScene): number[] {
  const all = (test: (n: string) => boolean) => scene.nodes.filter(n => test(n.name)).map(n => n.index)
  const words: Record<string, (n: string) => boolean> = {
    copper: n => n.startsWith('copper:'),
    mask: n => n === 'F.Mask' || n === 'B.Mask',
    silk: n => n === 'F.SilkS' || n === 'B.SilkS',
    bodies: n => n.startsWith('bodies:'),
    board: n => n === 'board',
    barrels: n => n === 'barrels',
    references: n => n.startsWith('reference:'),
  }
  if (words[name]) return all(words[name])
  if (scene.byName.has(name)) return scene.byName.get(name)!
  const id = flagLayer(name)
  const node = id ? (id.endsWith('.Cu') ? `copper:${id}` : id) : null
  if (node && scene.byName.has(node)) return scene.byName.get(node)!
  throw new Error(`render: no layer group ${name} in 3D; use ${Object.keys(words).join(', ')}, a layer id or a node name`)
}

/** Every node with geometry a target names: its parts and nets. */
function targetNodes(t: Target, scene: GlbScene): number[] {
  const names = [...t.parts.map(r => `part:${r}`), ...t.nets.map(n => `net:${n}`)]
  return names.flatMap(n => scene.byName.get(n) ?? []).filter(i => meshed(scene, i))
}

const targetSelections = (t: Target, scene: GlbScene): string[] => t.items.map(it => it.uid ?? `id:${it.id}`).filter(u => scene.items.has(u))

/** z in mm of the outer face of a layer: copper and silk from the stack, the rest on their side's copper. */
export function elevation(layer: string | undefined, site: SiteData): number {
  const slices = copperSlices(site)
  const mask = { F: maskThickness(site, 'F'), B: maskThickness(site, 'B') }
  const id = (layer && flagLayer(layer)) ?? 'F.Cu'
  if (id === 'F.Mask') return slices.get('F.Cu')!.z1 + mask.F
  if (id === 'B.Mask') return slices.get('B.Cu')!.z0 - mask.B
  const s = sliceOf(id, slices, mask) ?? slices.get(id.startsWith('B.') ? 'B.Cu' : 'F.Cu')!
  return id.startsWith('B.') ? s.z0 : s.z1
}

/** The stack group node a mark on a layer moves with when exploded. */
function layerNode(layer: string | undefined, scene: GlbScene): number | undefined {
  const id = (layer && flagLayer(layer)) ?? 'F.Cu'
  const name = id.endsWith('.Cu') ? `copper:${id}` : id
  return scene.byName.get(name)?.[0]
}

const facing = (layer: string | undefined, dir: Vec3): boolean => {
  const id = (layer && flagLayer(layer)) ?? 'F.Cu'
  if (/^In\d+\.Cu$/.test(id)) return false
  return id.startsWith('B.') ? dir[1] < 0 : dir[1] > 0
}

/** The renderer's annotations for the marks: positions at their layer's elevation, anchored to its node, depth-tested on a side facing the camera. */
export async function annotations(marks: Mark[], scene: GlbScene, site: SiteData, cam: Camera, explode: number, theme: Theme): Promise<Annotation[]> {
  const dir = viewDir(cam)
  const c = THEME_COLORS[theme]
  const outer = scene.byName.get(dir[1] >= 0 ? 'F.SilkS' : 'B.SilkS')?.[0]
  const out: Annotation[] = []
  for (const [i, m] of marks.entries()) {
    const z = elevation(m.layer, site)
    const node = layerNode(m.layer, scene)
    const lift = node !== undefined && outer !== undefined ? Math.abs(scene.nodes[outer].explode[1] - scene.nodes[node].explode[1]) * explode : 0
    const depth = m.depth ?? (facing(m.layer, dir) ? 'test' : 'always')
    const base = { id: `mark-${i}`, color: rgba(m.color ?? c.accent), depth, ...(depth === 'test' ? { depthBias: MARK_BIAS + lift } : {}), ...(node !== undefined ? { node } : {}) }
    const at = toWorld(m.at[0], m.at[1], z)
    if (m.type === 'line') out.push({ ...base, type: 'line', start: at, end: toWorld(m.to![0], m.to![1], z), width: 2 })
    else if (m.type === 'marker') out.push({ ...base, type: 'marker', position: at, radius: m.radius ?? 4 })
    else if (m.type === 'ring') out.push({ ...base, type: 'ring', position: at, radius: m.radius ?? 12, width: 2 })
    else {
      // a label's colour would replace its pixels' own
      const { color: _, ...plain } = base
      out.push({ ...plain, type: 'label', position: at, offset: LABEL_OFFSET, image: await labelImage(m.text!, m.color ?? c.accent, c.canvas) })
    }
  }
  return out
}

/** Translations of every stack group at `k` of the full explode. */
export function explodeTranslations(scene: GlbScene, k: number): { node: number; translation: Vec3 }[] {
  if (!k) return []
  return scene.nodes.filter(n => n.explode.some(v => v !== 0)).map(n => ({ node: n.index, translation: n.explode.map(v => v * k) as Vec3 }))
}

/** Highlight and dim as the viewer draws a selection, see highlight.md: the rest desaturated and tinted toward the canvas, opaque so no transparency pass runs; the anchor's net as context, a 1.5 px accent outline at 40 percent; each target a 2 px accent outline, 35 percent through what hides it, over a faint tint; layer opacities as asked. */
export function styles(spec: RenderSpec, highlight: Target[], scene: GlbScene, theme: Theme): RenderStyle[] {
  const { accent, canvas } = THEME_COLORS[theme]
  const dim = highlight.length ? (spec.dim ?? 0.6) : 0
  const faded = dim ? { saturation: 1 - dim, tint: rgba(canvas, FADE * dim) } : {}
  const out: RenderStyle[] = []
  if (dim) out.push(faded)
  for (const [name, o] of Object.entries(spec.opacity ?? {})) out.push({ nodes: groupNodes(name, scene), opacity: o, ...faded })
  const nodes = [...new Set(highlight.flatMap(t => targetNodes(t, scene)))]
  const selections = [...new Set(highlight.flatMap(t => targetSelections(t, scene)))]
  const own = new Set(highlight.flatMap(t => t.nets))
  const nets = new Set(highlight.flatMap(t => t.items.flatMap(it => (it.net && !own.has(it.net) ? [it.net] : []))))
  const context = [...nets].flatMap(n => scene.byName.get(`net:${n}`) ?? []).filter(i => meshed(scene, i) && !nodes.includes(i))
  const outline = { color: rgba(accent), width: 2, occludedAlpha: OCCLUDED_ALPHA }
  if (context.length) out.push({ nodes: context, outline: { color: rgba(accent, 0.4), width: 1.5, occludedAlpha: OCCLUDED_ALPHA } })
  if (nodes.length) out.push({ nodes, tint: rgba(accent, SEL_TINT), outline })
  if (selections.length) out.push({ selections, tint: rgba(accent, SEL_TINT), outline })
  return out
}

/** The bounds of a box in board mm over the board's thickness, in metres. */
export function boxBounds(b: Box, site: SiteData, layer?: string): Bounds {
  const slices = copperSlices(site)
  const z0 = layer ? elevation(layer, site) : slices.get('B.Cu')!.z0
  const z1 = layer ? z0 : slices.get('F.Cu')!.z1
  const a = toWorld(b[0], b[1], z0),
    c = toWorld(b[2], b[3], z1)
  return { min: [0, 1, 2].map(i => Math.min(a[i], c[i])) as Vec3, max: [0, 1, 2].map(i => Math.max(a[i], c[i])) as Vec3 }
}

/** The camera before framing: a preset, the spec's own, iso by default. */
export function cameraOf(spec: RenderSpec): Camera {
  const cam = spec.camera ?? 'iso'
  return typeof cam === 'string' ? presetCamera(cam, spec.side) : cam
}

/** What the worker frames, null for the whole board or an explicit camera. */
export function frameRequest(spec: RenderSpec, target: Target | null, scene: GlbScene, site: SiteData): FrameRequest | null {
  const cam = cameraOf(spec)
  if (!target || cam.type !== 'fit') return null
  return {
    camera: { ...cam, margin: 1 },
    nodes: targetNodes(target, scene),
    selections: targetSelections(target, scene),
    bounds: target.box ? boxBounds(target.box, site, target.layer) : null,
    margin: (spec.margin ?? 1) / 1000,
  }
}
