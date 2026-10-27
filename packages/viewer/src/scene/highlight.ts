// one material clone per base material, state and strength step, never per mesh; a level of 0 looks like the base
import * as THREE from 'three'
import { HL_OUTLINE_BELOW, hlStep } from './intensity'
import { GHOST_FILL } from './focus'

/** src: source highlight; sel: selection; net: active net; mate: the other nets of its pair group; hover: under the pointer; group: hovered instance; fade, dim: out of focus; see: semi-transparent; ghost: hovered out of focus, faded with an outline. */
export type HlState = 'src' | 'sel' | 'net' | 'mate' | 'hover' | 'group' | 'fade' | 'dim' | 'see' | 'ghost'
export const STATES: HlState[] = ['src', 'sel', 'net', 'mate', 'hover', 'group', 'fade', 'dim', 'see', 'ghost']

interface Tint { css: string; fallback: string; emissive: number; lerp: number }
const TINT: Partial<Record<HlState, Tint>> = {
  src: { css: '--accent', fallback: '#6ea8ff', emissive: 0.6, lerp: 0.3 },
  sel: { css: '--hl-sel', fallback: '#ffcc33', emissive: 0.75, lerp: 0.35 },
  net: { css: '--hl-net', fallback: '#ffffff', emissive: 0.45, lerp: 0.25 },
  hover: { css: '--hl-net', fallback: '#ffffff', emissive: 0.3, lerp: 0.15 },
  mate: { css: '--hl-net', fallback: '#ffffff', emissive: 0.2, lerp: 0.08 },
  group: { css: '--hl-sel', fallback: '#ffcc33', emissive: 0.35, lerp: 0.18 },
}
const tintOf = (s: HlState) => TINT[s === 'ghost' ? 'hover' : s]
export const FADE_OPACITY = 0.18
export const SEE_OPACITY = 0.35
const DIM = 0.6

/** How the content out of a focus is drawn: its opacity, greyscale, edges only, and grouped as one body or stacked. */
export interface Look { opacity: number; mono: boolean; edges: boolean; grouped: boolean }
export const LOOK: Look = { opacity: 0.25, mono: false, edges: false, grouped: true }
/** The fade outside a focus, the slab over inner copper: stacked, coloured, shaded. */
const PLAIN: Look = { opacity: FADE_OPACITY, mono: false, edges: false, grouped: false }
/** Render orders of the grouped passes, after every other transparent item: depth only, then the blend. */
export const PREPASS = 5, BLEND = 6
const WIRE_OPACITY = 0.55

/** A fragment shader that mixes its colour toward its luminance by the uniform `uSat`, 1 full colour, 0 grey. */
export function withSaturation(frag: string): string {
  return 'uniform float uSat;\n' + frag.replace('#include <opaque_fragment>', '#include <opaque_fragment>\n\tgl_FragColor.rgb = mix(vec3(dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722))), gl_FragColor.rgb, uSat);')
}

type Std = THREE.Material & { color?: THREE.Color; emissive?: THREE.Color; emissiveIntensity?: number }

export class Variants {
  private cache = new Map<THREE.Material, Map<string, THREE.Material>>()
  private byState = new Map<HlState, { v: Std; base: Std; tint: THREE.Color | null; strength: number }[]>()
  private levels = new Map<HlState, number>(STATES.map(s => [s, 1]))
  private lines = new Map<HlState, THREE.LineBasicMaterial>()
  private edges = new WeakMap<THREE.BufferGeometry, THREE.EdgesGeometry>()
  private look: Look = PLAIN
  private depths = new Map<string, THREE.MeshBasicMaterial>()
  private wireMat: THREE.LineBasicMaterial | null = null
  /** the saturation of every faded variant, one uniform for all */
  readonly sat = { value: 1 }
  /** faces drawn in edges mode: none */
  readonly hidden = new THREE.MeshBasicMaterial({ visible: false })
  private color: (css: string, fallback: string) => string
  constructor(color: (css: string, fallback: string) => string) { this.color = color }

  /** The variant of a material for a state; a tint at `strength`, 0 to 1, rounded to its step. */
  get(m: THREE.Material, s: HlState, strength = 1): THREE.Material {
    let per = this.cache.get(m)
    if (!per) this.cache.set(m, per = new Map())
    const q = TINT[s] ? hlStep(strength) : 1
    const key = `${s}:${q}`
    let v = per.get(key)
    if (!v) {
      const c = m.clone() as Std
      if (s === 'fade' || s === 'see' || s === 'ghost') { c.transparent = true; c.depthWrite = false }
      if (s === 'fade') {
        c.onBeforeCompile = sh => { sh.uniforms.uSat = this.sat; sh.fragmentShader = withSaturation(sh.fragmentShader) }
        c.customProgramCacheKey = () => 'pcbjs-sat'
      }
      const k = tintOf(s)
      const entry = { v: c, base: m as Std, tint: k ? new THREE.Color(this.color(k.css, k.fallback)) : null, strength: q }
      let list = this.byState.get(s)
      if (!list) this.byState.set(s, list = [])
      list.push(entry)
      this.apply(s, entry, this.levels.get(s)!)
      per.set(key, v = c)
    }
    return v
  }

  /** The outline material of a tinted state: the tint colour at full strength, faded in with the state's level. */
  line(s: HlState): THREE.LineBasicMaterial | null {
    const k = tintOf(s)
    if (!k) return null
    let l = this.lines.get(s)
    if (!l) this.lines.set(s, l = new THREE.LineBasicMaterial({ color: new THREE.Color(this.color(k.css, k.fallback)), transparent: true, opacity: this.levels.get(s)!, depthWrite: false }))
    return l
  }
  /** The outline of a geometry, its sharp edges, made once per geometry. */
  edgesOf(g: THREE.BufferGeometry): THREE.EdgesGeometry {
    let e = this.edges.get(g)
    if (!e) this.edges.set(g, e = new THREE.EdgesGeometry(g, 30))
    return e
  }

  /** The depth-only material of the grouped prepass; pushed back a hair in edges mode so the edges pass it. */
  depth(base: THREE.Material, edges: boolean): THREE.MeshBasicMaterial {
    const off = edges ? 1 : base.polygonOffset ? base.polygonOffsetFactor : 0
    const key = `${base.side}:${off}:${edges ? 1 : base.polygonOffsetUnits}`
    let d = this.depths.get(key)
    if (!d) this.depths.set(key, d = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, transparent: true, side: base.side, polygonOffset: off !== 0, polygonOffsetFactor: off, polygonOffsetUnits: edges ? 1 : base.polygonOffsetUnits }))
    return d
  }
  /** The muted line of edges mode, faded in with the fade. */
  wire(): THREE.LineBasicMaterial {
    return this.wireMat ??= new THREE.LineBasicMaterial({ color: new THREE.Color(this.color('--dim', '#8b93a1')), transparent: true, opacity: WIRE_OPACITY * this.levels.get('fade')!, depthWrite: false })
  }

  get current(): Look { return this.look }
  /** The look of the faded state: the owner's while a focus is on, null for the plain fade. */
  setLook(l: Look | null) {
    const next = l ?? PLAIN, o = this.look
    if (next.opacity === o.opacity && next.mono === o.mono && next.edges === o.edges && next.grouped === o.grouped) return
    this.look = { ...next }
    const k = this.levels.get('fade')!
    for (const e of this.byState.get('fade') ?? []) this.apply('fade', e, k)
    this.syncFade(k)
  }
  private syncFade(k: number) {
    this.sat.value = this.look.mono ? 1 - k : 1
    if (this.wireMat) this.wireMat.opacity = WIRE_OPACITY * k
  }

  level(s: HlState) { return this.levels.get(s)! }
  /** Set a state's level on every variant of it. */
  setLevel(s: HlState, k: number) {
    if (this.levels.get(s) === k) return
    this.levels.set(s, k)
    for (const e of this.byState.get(s) ?? []) this.apply(s, e, k)
    const l = this.lines.get(s)
    if (l) l.opacity = k
    if (s === 'fade') this.syncFade(k)
  }

  private apply(s: HlState, { v, base, tint, strength }: { v: Std; base: Std; tint: THREE.Color | null; strength: number }, k: number) {
    if (s === 'ghost') { v.opacity = Math.min(base.opacity, FADE_OPACITY); this.tint(v, base, tint!, TINT.hover!, GHOST_FILL) }
    else if (s === 'fade') {
      v.opacity = base.opacity + (Math.min(base.opacity, this.look.opacity) - base.opacity) * k
      v.depthFunc = this.look.grouped ? THREE.EqualDepth : base.depthFunc
    }
    else if (s === 'see') v.opacity = base.opacity + (Math.min(base.opacity, SEE_OPACITY) - base.opacity) * k
    else if (s === 'dim') { if (v.color && base.color) v.color.copy(base.color).multiplyScalar(1 - (1 - DIM) * k) }
    else if (tint) this.tint(v, base, tint, TINT[s]!, k * strength)
  }
  // the tint of a large item is weaker: its emissive colour, its emissive intensity and its colour all move less
  private tint(v: Std, base: Std, tint: THREE.Color, t: Tint, w: number) {
    if (v.emissive && base.emissive) { v.emissive.copy(base.emissive).lerp(tint, w); v.emissiveIntensity = (base.emissiveIntensity ?? 1) + (t.emissive - (base.emissiveIntensity ?? 1)) * w }
    if (v.color && base.color) v.color.copy(base.color).lerp(tint, t.lerp * w)
  }

  /** Drop every variant, for a theme change that moves the accent colours. */
  dispose() {
    for (const per of this.cache.values()) for (const v of per.values()) v.dispose()
    for (const l of this.lines.values()) l.dispose()
    for (const d of this.depths.values()) d.dispose()
    this.wireMat?.dispose(); this.wireMat = null
    this.cache.clear(); this.byState.clear(); this.lines.clear(); this.depths.clear()
  }
}

/** Set a mesh's material to its base's variant for a state, or the base for null; weak tints and a ghost, a pour excepted, also show the outline; a faded mesh takes the look's edges and passes. */
export function setState(mesh: THREE.Mesh, s: HlState | null, variants: Variants) {
  const base = (mesh.userData.base ??= mesh.material) as THREE.Material | THREE.Material[]
  const strength: number = mesh.userData.strength ?? 1
  const order: number = (mesh.userData.order ??= mesh.renderOrder)
  mesh.userData.hl = s
  const look = variants.current, out = s === 'fade'
  const want = s === null ? base
    : out && look.edges ? (Array.isArray(base) ? base.map(() => variants.hidden) : variants.hidden)
    : Array.isArray(base) ? base.map(m => variants.get(m, s, strength)) : variants.get(base, s, strength)
  if (mesh.material !== want) mesh.material = want
  mesh.renderOrder = out && look.grouped ? BLEND : order
  const pre = out && look.grouped ? variants.depth(Array.isArray(base) ? base[0] : base, look.edges) : null
  attach(mesh, 'prepass', pre, PREPASS, () => new THREE.Mesh(mesh.geometry, pre!))
  const wire = out && look.edges ? variants.wire() : null
  attach(mesh, 'wire', wire, BLEND, () => new THREE.LineSegments(variants.edgesOf(mesh.geometry), wire!))
  // a pour out of focus keeps no outline: its edges are every clearance cut into it, across the whole board
  const ghost = s === 'ghost' && mesh.userData.kind !== 'zone'
  const line = ghost || (s && s !== 'ghost' && strength < HL_OUTLINE_BELOW && !mesh.userData.noOutline) ? variants.line(s) : null
  let o = mesh.userData.outline as THREE.LineSegments | undefined
  if (line && !o) {
    o = new THREE.LineSegments(variants.edgesOf(mesh.geometry), line)
    o.renderOrder = 2
    o.raycast = () => {}
    mesh.userData.outline = o
    mesh.add(o)
  }
  if (o) {
    o.visible = !!line
    if (line && o.material !== line) o.material = line
  }
}

/** A child drawn with a mesh for one pass, made the first time it is needed and hidden while `mat` is null. */
function attach(mesh: THREE.Mesh, key: string, mat: THREE.Material | null, order: number, make: () => THREE.Mesh | THREE.LineSegments) {
  let c = mesh.userData[key] as THREE.Mesh | THREE.LineSegments | undefined
  if (mat && !c) {
    c = make()
    c.renderOrder = order
    c.raycast = () => {}
    mesh.userData[key] = c
    mesh.add(c)
  }
  if (!c) return
  c.visible = !!mat
  if (mat && c.material !== mat) c.material = mat
}
