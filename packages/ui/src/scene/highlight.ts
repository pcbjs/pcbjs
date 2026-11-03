// one material clone per base material and state, never per mesh; a level of 0 looks like the base. Selection itself is the
// outline of ./outline; a selected mesh only takes a faint Fresnel rim in the accent.
import * as THREE from 'three'

/** rim: selected; fade, dim: out of focus; see: semi-transparent. */
export type HlState = 'rim' | 'fade' | 'dim' | 'see'
export const STATES: HlState[] = ['rim', 'fade', 'dim', 'see']

export const FADE_OPACITY = 0.18
export const SEE_OPACITY = 0.35
/** the Fresnel rim of a selected mesh at grazing angles, as a fraction toward the accent */
export const RIM = 0.15
const DIM = 0.6
/** How the content out of a focus is drawn: its opacity, greyscale, edges only, and grouped as one body or stacked. */
export interface Look {
  opacity: number
  mono: boolean
  edges: boolean
  grouped: boolean
}
export const LOOK: Look = { opacity: 0.25, mono: false, edges: false, grouped: true }
/** The fade outside a focus, the slab over inner copper: stacked, coloured, shaded. */
const PLAIN: Look = { opacity: FADE_OPACITY, mono: false, edges: false, grouped: false }
/** Render orders of the grouped passes, after every other transparent item: depth only, then the blend. */
export const PREPASS = 5,
  BLEND = 6
const WIRE_OPACITY = 0.55

/** A fragment shader that mixes its colour toward the uniform `uRimColor` at grazing angles, by `uRim`; a shader without a view position is left as it is. */
export function withRim(frag: string): string {
  if (!frag.includes('vViewPosition')) return frag
  return (
    'uniform vec3 uRimColor;\nuniform float uRim;\n' +
    frag.replace(
      '#include <opaque_fragment>',
      '#include <opaque_fragment>\n\tgl_FragColor.rgb = mix(gl_FragColor.rgb, uRimColor, uRim * pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 3.0));',
    )
  )
}

/** A fragment shader that mixes its colour toward its luminance by the uniform `uSat`, 1 full colour, 0 grey. */
export function withSaturation(frag: string): string {
  return (
    'uniform float uSat;\n' +
    frag.replace(
      '#include <opaque_fragment>',
      '#include <opaque_fragment>\n\tgl_FragColor.rgb = mix(vec3(dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722))), gl_FragColor.rgb, uSat);',
    )
  )
}

type Std = THREE.Material & { color?: THREE.Color; emissive?: THREE.Color; emissiveIntensity?: number }

export class Variants {
  private cache = new Map<THREE.Material, Map<string, THREE.Material>>()
  private byState = new Map<HlState, { v: Std; base: Std }[]>()
  private levels = new Map<HlState, number>(STATES.map(s => [s, 1]))
  /** the rim of every selected variant, one pair of uniforms for all */
  readonly rim = { color: { value: new THREE.Color() }, k: { value: RIM } }
  private edges = new WeakMap<THREE.BufferGeometry, THREE.EdgesGeometry>()
  private look: Look = PLAIN
  private depths = new Map<string, THREE.MeshBasicMaterial>()
  private wireMat: THREE.LineBasicMaterial | null = null
  /** the saturation of every faded variant, one uniform for all */
  readonly sat = { value: 1 }
  /** faces drawn in edges mode: none */
  readonly hidden = new THREE.MeshBasicMaterial({ visible: false })
  private color: (css: string, fallback: string) => string
  constructor(color: (css: string, fallback: string) => string) {
    this.color = color
  }

  /** The variant of a material for a state. */
  get(m: THREE.Material, s: HlState): THREE.Material {
    let per = this.cache.get(m)
    if (!per) this.cache.set(m, (per = new Map()))
    let v = per.get(s)
    if (!v) {
      const c = m.clone() as Std
      if (s === 'rim') {
        this.rim.color.value.set(this.color('--accent', '#6ea8ff'))
        c.onBeforeCompile = sh => {
          sh.uniforms.uRimColor = this.rim.color
          sh.uniforms.uRim = this.rim.k
          sh.fragmentShader = withRim(sh.fragmentShader)
        }
        c.customProgramCacheKey = () => 'pcbjs-rim'
      }
      if (s === 'fade' || s === 'see') {
        c.transparent = true
        c.depthWrite = false
      }
      if (s === 'fade') {
        c.onBeforeCompile = sh => {
          sh.uniforms.uSat = this.sat
          sh.fragmentShader = withSaturation(sh.fragmentShader)
        }
        c.customProgramCacheKey = () => 'pcbjs-sat'
      }
      const entry = { v: c, base: m as Std }
      let list = this.byState.get(s)
      if (!list) this.byState.set(s, (list = []))
      list.push(entry)
      this.apply(s, entry, this.levels.get(s)!)
      per.set(s, (v = c))
    }
    return v
  }
  /** The outline of a geometry, its sharp edges, made once per geometry. */
  edgesOf(g: THREE.BufferGeometry): THREE.EdgesGeometry {
    let e = this.edges.get(g)
    if (!e) this.edges.set(g, (e = new THREE.EdgesGeometry(g, 30)))
    return e
  }

  /** The depth-only material of the grouped prepass; pushed back a hair in edges mode so the edges pass it. */
  depth(base: THREE.Material, edges: boolean): THREE.MeshBasicMaterial {
    const off = edges ? 1 : base.polygonOffset ? base.polygonOffsetFactor : 0
    const key = `${base.side}:${off}:${edges ? 1 : base.polygonOffsetUnits}`
    let d = this.depths.get(key)
    if (!d)
      this.depths.set(
        key,
        (d = new THREE.MeshBasicMaterial({
          colorWrite: false,
          // depth alone: one pass of both faces writes what two would
          forceSinglePass: true,
          depthWrite: true,
          transparent: true,
          side: base.side,
          polygonOffset: off !== 0,
          polygonOffsetFactor: off,
          polygonOffsetUnits: edges ? 1 : base.polygonOffsetUnits,
        })),
      )
    return d
  }
  /** The muted line of edges mode, faded in with the fade. */
  wire(): THREE.LineBasicMaterial {
    return (this.wireMat ??= new THREE.LineBasicMaterial({
      color: new THREE.Color(this.color('--dim', '#8b93a1')),
      transparent: true,
      opacity: WIRE_OPACITY * this.levels.get('fade')!,
      depthWrite: false,
    }))
  }

  get current(): Look {
    return this.look
  }
  /** The look of the faded state: the owner's while a focus is on, null for the plain fade. */
  setLook(l: Look | null) {
    const next = l ?? PLAIN,
      o = this.look
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

  level(s: HlState) {
    return this.levels.get(s)!
  }
  /** Set a state's level on every variant of it. */
  setLevel(s: HlState, k: number) {
    if (this.levels.get(s) === k) return
    this.levels.set(s, k)
    for (const e of this.byState.get(s) ?? []) this.apply(s, e, k)
    if (s === 'rim') this.rim.k.value = RIM * k
    if (s === 'fade') this.syncFade(k)
  }

  private apply(s: HlState, { v, base }: { v: Std; base: Std }, k: number) {
    if (s === 'fade') {
      v.opacity = base.opacity + (Math.min(base.opacity, this.look.opacity) - base.opacity) * k
      v.depthFunc = this.look.grouped ? THREE.EqualDepth : base.depthFunc
      // after the prepass only the nearest face passes, so the back faces need no pass of their own
      v.forceSinglePass = this.look.grouped
    } else if (s === 'see') v.opacity = base.opacity + (Math.min(base.opacity, SEE_OPACITY) - base.opacity) * k
    else if (s === 'dim') {
      if (v.color && base.color) v.color.copy(base.color).multiplyScalar(1 - (1 - DIM) * k)
    }
  }

  /** Drop every variant, for a theme change that moves the accent colours. */
  dispose() {
    for (const per of this.cache.values()) for (const v of per.values()) v.dispose()
    for (const d of this.depths.values()) d.dispose()
    this.wireMat?.dispose()
    this.wireMat = null
    this.cache.clear()
    this.byState.clear()
    this.depths.clear()
  }
}

/** Set a mesh's material to its base's variant for a state, or the base for null; a faded mesh takes the look's edges and passes. */
export function setState(mesh: THREE.Mesh, s: HlState | null, variants: Variants) {
  const base = (mesh.userData.base ??= mesh.material) as THREE.Material | THREE.Material[]
  const order: number = (mesh.userData.order ??= mesh.renderOrder)
  mesh.userData.hl = s
  const look = variants.current,
    out = s === 'fade'
  const want =
    s === null
      ? base
      : out && look.edges
        ? Array.isArray(base)
          ? base.map(() => variants.hidden)
          : variants.hidden
        : Array.isArray(base)
          ? base.map(m => variants.get(m, s))
          : variants.get(base, s)
  if (mesh.material !== want) mesh.material = want
  mesh.renderOrder = out && look.grouped ? BLEND : order
  const pre = out && look.grouped ? variants.depth(Array.isArray(base) ? base[0] : base, look.edges) : null
  attach(mesh, 'prepass', pre, PREPASS, () => like(mesh, pre!))
  const wire = out && look.edges ? variants.wire() : null
  attach(mesh, 'wire', wire, BLEND, () => new THREE.LineSegments(edgesOf(mesh, variants), wire!))
  const w = mesh.userData.wire as THREE.LineSegments | undefined
  if (wire && w) w.geometry = edgesOf(mesh, variants)
}

/** A mesh drawing another's geometry, instanced alike when it is instanced. */
function like(mesh: THREE.Mesh, mat: THREE.Material): THREE.Mesh {
  if (!(mesh as THREE.InstancedMesh).isInstancedMesh) return new THREE.Mesh(mesh.geometry, mat)
  const m = mesh as THREE.InstancedMesh
  const c = new THREE.InstancedMesh(m.geometry, mat, m.instanceMatrix.count)
  c.instanceMatrix = m.instanceMatrix
  return c
}

const wires = new WeakMap<THREE.Object3D, { ver: number; geo: THREE.BufferGeometry }>()
/** A mesh's edge lines: its `edges` geometry's when it draws part of one, every instance's laid out as one set when instanced. */
function edgesOf(mesh: THREE.Mesh, variants: Variants): THREE.BufferGeometry {
  const edges = variants.edgesOf(mesh.userData.edges ?? mesh.geometry)
  const m = mesh as THREE.InstancedMesh
  if (!m.isInstancedMesh) return edges
  const hit = wires.get(m)
  if (hit && hit.ver === m.userData.ver) return hit.geo
  const src = edges.attributes.position,
    out = new Float32Array(src.count * 3 * m.count),
    at = new THREE.Matrix4(),
    v = new THREE.Vector3()
  for (let i = 0, k = 0; i < m.count; i++) {
    m.getMatrixAt(i, at)
    for (let j = 0; j < src.count; j++, k += 3) v.fromBufferAttribute(src, j).applyMatrix4(at).toArray(out, k)
  }
  hit?.geo.dispose()
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(out, 3))
  wires.set(m, { ver: m.userData.ver, geo })
  return geo
}

/** A child drawn with a mesh for one pass, made the first time it is needed and hidden while `mat` is null; an instanced child follows its parent's count. */
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
  const inst = c as THREE.InstancedMesh
  if (inst.isInstancedMesh) {
    inst.count = (mesh as THREE.InstancedMesh).count
    inst.boundingSphere = null
  }
}
