// The findings' dots in the 3D view: one instanced quad per dot, turned to the camera and sized in screen pixels in the vertex shader, so
// any number of findings is one draw call; positions in the board group's frame, mm; looks from dotLook in ../finding-marks.ts.
import * as THREE from 'three'
import type { DotShape } from '../finding-marks'

const SHAPE: Record<DotShape, number> = { disc: 0, ring: 1, diamond: 2 }
/** above the selection overlay and the ratsnest, under the tools */
const ORDER = 8

const VERTEX = `
attribute vec4 look;
uniform vec2 resolution;
varying vec2 vUv;
varying vec3 vColor;
varying vec2 vLook;
void main() {
  vec4 c = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  // look.x is the diameter in device pixels; the quad is a pixel wider for the rim
  gl_Position = c + vec4(position.xy * (look.x + 2.0) * 2.0 / resolution * c.w, 0.0, 0.0);
  vUv = position.xy * 2.0 * (look.x + 2.0) / max(look.x, 1.0);
  vColor = instanceColor;
  vLook = look.yz;
}`
// a dark rim a pixel and a half wide keeps a dot readable on copper, mask and silk alike
const FRAGMENT = `
uniform vec3 rim;
varying vec2 vUv;
varying vec3 vColor;
varying vec2 vLook;
void main() {
  float shape = vLook.y;
  float d = shape > 1.5 ? (abs(vUv.x) + abs(vUv.y)) * 0.75 : length(vUv);
  float aa = fwidth(d);
  float outer = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, d);
  float inner = 1.0 - smoothstep(0.8 - aa, 0.8 + aa, d);
  float hole = shape > 0.5 && shape < 1.5 ? smoothstep(0.42 - aa, 0.42 + aa, d) : 1.0;
  vec3 color = mix(rim, vColor, inner);
  float a = outer * mix(1.0, hole, inner) * vLook.x;
  if (a < 0.01) discard;
  gl_FragColor = vec4(color, a);
}`

export interface DotDraw {
  /** board mm, y down, and the height in the board group */
  at: [number, number, number]
  color: THREE.Color
  shape: DotShape
  size: number
  alpha: number
}

export class FindingDots {
  mesh: THREE.InstancedMesh
  private look!: THREE.InstancedBufferAttribute
  private material: THREE.ShaderMaterial
  private capacity: number
  private m = new THREE.Matrix4()
  /** each dot's centre in the board group, x y z packed */
  private centres = new Float32Array(0)

  constructor(capacity = 64) {
    this.capacity = capacity
    this.material = new THREE.ShaderMaterial({
      uniforms: { resolution: { value: new THREE.Vector2(1, 1) }, rim: { value: new THREE.Color('#111316') } },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    })
    this.mesh = this.make(capacity)
  }

  private make(n: number): THREE.InstancedMesh {
    const geo = new THREE.PlaneGeometry(1, 1)
    this.look = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4)
    geo.setAttribute('look', this.look)
    const mesh = new THREE.InstancedMesh(geo, this.material, n)
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3)
    mesh.count = 0
    mesh.frustumCulled = false
    mesh.renderOrder = ORDER
    mesh.userData.pick = false
    mesh.raycast = () => {}
    return mesh
  }

  /** The drawing buffer's size in device pixels, which the dot sizes are in. */
  resolution(w: number, h: number) {
    this.material.uniforms.resolution.value.set(w, h)
  }

  /** Every dot at once; `ratio` the device pixels per CSS pixel. A larger set than the mesh holds grows it, the caller adding the new mesh. */
  set(dots: readonly DotDraw[], ratio: number): boolean {
    let grown = false
    if (dots.length > this.capacity) {
      const parent = this.mesh.parent
      parent?.remove(this.mesh)
      this.mesh.geometry.dispose()
      this.capacity = Math.max(dots.length, this.capacity * 2)
      this.mesh = this.make(this.capacity)
      parent?.add(this.mesh)
      grown = true
    }
    this.centres = new Float32Array(dots.length * 3)
    dots.forEach((d, i) => {
      this.m.makeTranslation(d.at[0], -d.at[1], d.at[2])
      this.mesh.setMatrixAt(i, this.m)
      this.mesh.setColorAt(i, d.color)
      this.look.setXYZW(i, d.size * ratio, d.alpha, SHAPE[d.shape], 0)
      this.centres.set([d.at[0], -d.at[1], d.at[2]], i * 3)
    })
    this.mesh.count = dots.length
    this.mesh.instanceMatrix.needsUpdate = true
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
    this.look.needsUpdate = true
    return grown
  }

  /** One dot's size and opacity, as a hover or a focus changes it, without touching the others. */
  restyle(i: number, size: number, alpha: number, ratio: number) {
    if (i < 0 || i >= this.mesh.count) return
    this.look.setX(i, size * ratio)
    this.look.setY(i, alpha)
    this.look.needsUpdate = true
  }

  /** Each dot's centre on screen in CSS px, x y packed, NaN behind the camera; `world` the board group's matrix. */
  screen(world: THREE.Matrix4, camera: THREE.Camera, w: number, h: number, out = new Float32Array(this.mesh.count * 2)): Float32Array {
    const v = new THREE.Vector3()
    for (let i = 0; i < this.mesh.count; i++) {
      v.fromArray(this.centres, i * 3)
        .applyMatrix4(world)
        .project(camera)
      const off = v.z > 1 || this.look.getY(i) === 0
      out[2 * i] = off ? NaN : ((v.x + 1) / 2) * w
      out[2 * i + 1] = off ? NaN : ((1 - v.y) / 2) * h
    }
    return out
  }

  dispose() {
    this.mesh.geometry.dispose()
    this.material.dispose()
  }
}
