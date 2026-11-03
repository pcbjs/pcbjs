// The 3D selection outline: the meshes of each highlight state drawn as proxies into an id buffer, then a screen pass that
// draws a silhouette of each state around them, at a lower alpha where the scene hides them. Proxies share the meshes'
// geometry and copy their world matrix every frame, so a hidden item's own mesh inside merged copper outlines without showing.
import * as THREE from 'three'

/** In rising priority: a higher state's outline wins where two meet. */
export const OUTLINE_STATES = ['ctx', 'hover', 'sel', 'anchor'] as const
export type OutlineState = (typeof OUTLINE_STATES)[number]
export interface OutlineStyle {
  color: string
  /** CSS px */
  width: number
  alpha: number
}
/** A part of the drawing buffer in device pixels from its top left corner. */
type Rect = { x: number; y: number; w: number; h: number }
/** device pixels kept around the outlined meshes' box, past the widest outline */
const PAD = 12
/** above this share of the buffer the depth pass draws it whole */
const WHOLE = 0.5
const inside = (a: Rect, b: Rect) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h

/** the alpha of an outline where the scene hides what it outlines */
export const OCCLUDED_ALPHA = 0.35

const VERT = `varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`
const FRAG = `uniform sampler2D tAll;
uniform sampler2D tVis;
uniform vec2 texel;
uniform vec3 c1; uniform vec3 c2; uniform vec3 c3; uniform vec3 c4;
uniform vec4 wa;
uniform vec4 aa;
uniform float occluded;
varying vec2 vUv;
int stateAt(vec2 uv) { return int(texture2D(tAll, uv).r * 4.0 + 0.5); }
float pick4(vec4 v, int i) { return i == 1 ? v.x : i == 2 ? v.y : i == 3 ? v.z : v.w; }
vec3 colorOf(int i) { return i == 1 ? c1 : i == 2 ? c2 : i == 3 ? c3 : c4; }
void main() {
  int here = stateAt(vUv);
  int bc = 0;
  float best = 0.0;
  float vis = 0.0;
  for (int dx = -3; dx <= 3; dx++) {
    for (int dy = -3; dy <= 3; dy++) {
      vec2 o = vec2(float(dx), float(dy));
      vec2 uv = vUv + o * texel;
      int c = stateAt(uv);
      if (c <= here) continue;
      float cover = clamp(pick4(wa, c) + 0.5 - length(o), 0.0, 1.0);
      if (cover <= 0.0) continue;
      if (c > bc || (c == bc && cover > best)) {
        bc = c;
        best = cover;
        vis = texture2D(tVis, uv).g;
      }
    }
  }
  if (bc == 0) discard;
  gl_FragColor = vec4(colorOf(bc), best * pick4(aa, bc) * (vis > 0.5 ? 1.0 : occluded));
  #include <colorspace_fragment>
}`

export class Outline {
  private all = new THREE.WebGLRenderTarget(1, 1)
  private vis = new THREE.WebGLRenderTarget(1, 1)
  private proxies = new THREE.Scene()
  private sources = new Map<THREE.Mesh, THREE.Mesh>()
  private ids = OUTLINE_STATES.map(
    (_, i) => new THREE.MeshBasicMaterial({ color: new THREE.Color((i + 1) / 4, 0, 0), depthTest: false, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
  )
  // tests the scene's depth without writing it, so a hover redraws the outlines over the depth kept from the frame before
  private visMat = new THREE.MeshBasicMaterial({
    color: 0x00ff00,
    depthWrite: false,
    depthFunc: THREE.LessEqualDepth,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4,
    side: THREE.DoubleSide,
    toneMapped: false,
  })
  private depthMat = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide })
  private quad: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
  private screen = new THREE.Scene()
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private size = new THREE.Vector2()
  /** the vis target holds the scene's depth of the last full pass, within `depthRect`, the whole target when null */
  private depth = false
  private depthRect: Rect | null = null
  private sub = new THREE.PerspectiveCamera()
  private box = new THREE.Box3()
  private corner = new THREE.Vector4()

  constructor() {
    this.all.texture.colorSpace = THREE.NoColorSpace
    this.vis.texture.colorSpace = THREE.NoColorSpace
    this.quad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        uniforms: {
          tAll: { value: this.all.texture },
          tVis: { value: this.vis.texture },
          texel: { value: new THREE.Vector2() },
          c1: { value: new THREE.Color() },
          c2: { value: new THREE.Color() },
          c3: { value: new THREE.Color() },
          c4: { value: new THREE.Color() },
          wa: { value: new THREE.Vector4() },
          aa: { value: new THREE.Vector4() },
          occluded: { value: OCCLUDED_ALPHA },
        },
      }),
    )
    this.quad.frustumCulled = false
    this.screen.add(this.quad)
  }

  /** The meshes each state outlines; a mesh in two states takes the higher. */
  set(states: Partial<Record<OutlineState, Iterable<THREE.Mesh>>>) {
    const want = new Map<THREE.Mesh, number>()
    OUTLINE_STATES.forEach((s, i) => {
      for (const m of states[s] ?? []) want.set(m, i)
    })
    for (const [src, p] of this.sources)
      if (!want.has(src)) {
        this.proxies.remove(p)
        this.sources.delete(src)
      }
    for (const [src, i] of want) {
      let p = this.sources.get(src)
      if (!p) {
        p = new THREE.Mesh(src.geometry, this.ids[i])
        p.matrixAutoUpdate = false
        p.frustumCulled = false
        this.sources.set(src, p)
        this.proxies.add(p)
      }
      p.material = this.ids[i]
      p.renderOrder = i
    }
  }
  get active(): boolean {
    return this.sources.size > 0
  }
  /** Each state's colour, width and alpha. */
  style(styles: Record<OutlineState, OutlineStyle>, ratio: number) {
    const u = this.quad.material.uniforms
    OUTLINE_STATES.forEach((s, i) => {
      ;(u[`c${i + 1}`].value as THREE.Color).set(styles[s].color)
    })
    u.wa.value.set(...OUTLINE_STATES.map(s => styles[s].width * ratio))
    u.aa.value.set(...OUTLINE_STATES.map(s => styles[s].alpha))
  }

  /** The screen box of the outlined meshes, padded, in device pixels; null when it is most of the buffer or reaches behind the camera. */
  private region(camera: THREE.Camera, w: number, h: number): Rect | null {
    if (!(camera as THREE.PerspectiveCamera).isPerspectiveCamera) return null
    const box = this.box.makeEmpty()
    for (const src of this.sources.keys()) box.expandByObject(src)
    if (box.isEmpty()) return null
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity
    for (let i = 0; i < 8; i++) {
      const c = this.corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z, 1)
      c.applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix)
      if (c.w <= 1e-6) return null
      const x = ((c.x / c.w + 1) / 2) * w,
        y = ((1 - c.y / c.w) / 2) * h
      x0 = Math.min(x0, x)
      x1 = Math.max(x1, x)
      y0 = Math.min(y0, y)
      y1 = Math.max(y1, y)
    }
    const x = Math.max(0, Math.floor(x0 - PAD)),
      y = Math.max(0, Math.floor(y0 - PAD))
    const r = { x, y, w: Math.min(w, Math.ceil(x1 + PAD)) - x, h: Math.min(h, Math.ceil(y1 + PAD)) - y }
    if (r.w <= 0 || r.h <= 0) return { x: 0, y: 0, w: 1, h: 1 }
    return r.w * r.h > WHOLE * w * h ? null : r
  }

  /** The scene's depth for the occlusion, drawn through a camera narrowed to `r`, so what lies outside it is culled and never drawn. */
  private drawDepth(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, r: Rect | null, w: number, h: number) {
    if (!r) return renderer.render(scene, camera)
    this.sub.copy(camera as THREE.PerspectiveCamera)
    this.sub.setViewOffset(w, h, r.x, r.y, r.w, r.h)
    this.vis.viewport.set(r.x, h - r.y - r.h, r.w, r.h)
    this.vis.scissor.copy(this.vis.viewport)
    this.vis.scissorTest = true
    renderer.setRenderTarget(this.vis)
    renderer.render(scene, this.sub)
    this.vis.viewport.set(0, 0, w, h)
    this.vis.scissorTest = false
    renderer.setRenderTarget(this.vis)
  }

  /** Draw the outlines over the frame just rendered; with `occlusion` the scene's opaque meshes hide what is behind them, `seeThrough` left out of that; `keepDepth` when only the outlined set changed since the last frame, so the scene's depth is not drawn again. */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, occlusion: boolean, seeThrough: readonly THREE.Object3D[], keepDepth = false) {
    if (!this.active) {
      this.depth = false
      return
    }
    renderer.getDrawingBufferSize(this.size)
    const w = Math.max(1, this.size.x),
      h = Math.max(1, this.size.y)
    if (this.all.width !== w || this.all.height !== h) {
      this.all.setSize(w, h)
      this.vis.setSize(w, h)
      this.depth = false
    }
    ;(this.quad.material.uniforms.texel.value as THREE.Vector2).set(1 / w, 1 / h)
    for (const [src, p] of this.sources) p.matrix.copy(src.matrixWorld)
    const target = renderer.getRenderTarget(),
      auto = renderer.autoClear,
      clear = renderer.getClearColor(new THREE.Color()),
      clearAlpha = renderer.getClearAlpha()
    renderer.autoClear = false
    renderer.setClearColor(0x000000, 0)
    renderer.setRenderTarget(this.vis)
    const rect = occlusion ? this.region(camera, w, h) : null
    const reuse = occlusion && keepDepth && this.depth && (!this.depthRect || (!!rect && inside(rect, this.depthRect)))
    renderer.clear(true, !reuse, !reuse)
    this.depth = occlusion
    if (occlusion && !reuse) {
      this.depthRect = rect
      const bg = scene.background
      const was = seeThrough.map(o => o.visible)
      seeThrough.forEach(o => (o.visible = false))
      scene.background = null
      scene.overrideMaterial = this.depthMat
      this.drawDepth(renderer, scene, camera, rect, w, h)
      scene.overrideMaterial = null
      scene.background = bg
      seeThrough.forEach((o, i) => (o.visible = was[i]))
    }
    this.proxies.overrideMaterial = this.visMat
    renderer.render(this.proxies, camera)
    this.proxies.overrideMaterial = null
    renderer.setRenderTarget(this.all)
    renderer.clear()
    renderer.render(this.proxies, camera)
    renderer.setRenderTarget(target)
    renderer.render(this.screen, this.cam)
    renderer.autoClear = auto
    renderer.setClearColor(clear, clearAlpha)
  }

  dispose() {
    this.all.dispose()
    this.vis.dispose()
    for (const m of [...this.ids, this.visMat, this.depthMat, this.quad.material]) m.dispose()
    this.quad.geometry.dispose()
    this.sources.clear()
  }
}
