// ported from KiView's viewer; the steps and tones are the 2D grid's, see ../grid.ts
import * as THREE from 'three'
import { gridStep, parseColor } from '../grid'

/** the extent snaps to this many mm, and the labels stand at least this far apart */
const SNAP = 10

function labelSprite(text: string, color: string): THREE.Sprite {
  const c = document.createElement('canvas')
  c.width = 64; c.height = 32
  const g = c.getContext('2d')!
  g.font = '500 20px system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif'
  g.fillStyle = '#ffffff'
  g.textAlign = 'center'; g.textBaseline = 'middle'
  g.fillText(text, 32, 17)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.7, depthWrite: false, color }))
  s.scale.set(3, 1.5, 1)
  return s
}

export type Tones = Record<'minor' | 'major' | 'origin', string>

export class Grid {
  readonly root = new THREE.Group()
  private lines: THREE.LineSegments[] = []
  private labels = new THREE.Group()
  private extent: [number, number, number, number] | null = null
  private step = 0
  private tones: Tones = { minor: 'rgba(90, 101, 115, 0.12)', major: 'rgba(90, 101, 115, 0.35)', origin: 'rgba(90, 101, 115, 0.5)' }
  on = true
  z = 0

  constructor() { this.root.name = 'grid'; this.root.renderOrder = -1 }

  /** Size the plane for a board extent in three coordinates; `pad` is the margin around it, 2 mm by default, snapped out to 10 mm. */
  build(box: THREE.Box3, pad = 2) {
    const lo = (v: number) => Math.floor((v - pad) / SNAP) * SNAP, hi = (v: number) => Math.ceil((v + pad) / SNAP) * SNAP
    this.extent = [lo(box.min.x), lo(box.min.y), hi(box.max.x), hi(box.max.y)]
    this.z = box.min.z - 0.5
    this.root.position.z = this.z
    this.draw()
  }

  /** The grid's colours, as the --grid-* tokens give them. */
  setTones(t: Tones) { this.tones = t; this.draw() }

  private draw() {
    this.clear()
    if (!this.extent || !this.step) return
    const [x0, y0, x1, y1] = this.extent
    const major = this.step * 10
    const on = (v: number, s: number) => Math.abs(v / s - Math.round(v / s)) < 1e-6
    const seg = (pick: (v: number) => boolean) => {
      const pts: number[] = []
      for (let k = Math.ceil(x0 / this.step); k * this.step <= x1 + 1e-6; k++) { const x = k * this.step; if (pick(x)) pts.push(x, y0, 0, x, y1, 0) }
      for (let k = Math.ceil(y0 / this.step); k * this.step <= y1 + 1e-6; k++) { const y = k * this.step; if (pick(y)) pts.push(x0, y, 0, x1, y, 0) }
      return pts
    }
    const add = (pts: number[], tone: string, order: number) => {
      if (!pts.length) return
      const c = parseColor(tone) ?? { hex: '#5a6573', alpha: 0.3 }
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
      const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: c.hex, transparent: true, opacity: c.alpha, depthWrite: false }))
      l.renderOrder = order
      this.lines.push(l)
      this.root.add(l)
    }
    add(seg(v => !on(v, major) && Math.abs(v) > 1e-6), this.tones.minor, -3)
    add(seg(v => on(v, major) && Math.abs(v) > 1e-6), this.tones.major, -2)
    add(seg(v => Math.abs(v) < 1e-6), this.tones.origin, -1)
    // labels in board millimetres: x along the near edge, y (down on the board, -y in three) along the left edge
    const every = Math.max(major, SNAP), color = parseColor(this.tones.origin)?.hex ?? '#9aa6b5'
    for (let x = Math.ceil(x0 / every) * every; x <= x1 + 1e-6; x += every) { const s = labelSprite(String(x), color); s.position.set(x, y0 - 2, 0); this.labels.add(s) }
    for (let y = Math.ceil(y0 / every) * every; y <= y1 + 1e-6; y += every) { if (y === y0) continue; const s = labelSprite(String(-y), color); s.position.set(x0 - 3, y, 0); this.labels.add(s) }
    this.root.add(this.labels)
  }

  /** Per frame, with the screen pixels per mm at the camera's target: hidden under the plane, the steps of the 2D grid. True when a redraw is due. */
  update(camera: THREE.Camera, ppm: number): boolean {
    const show = this.on && !!this.extent && camera.position.z > this.root.position.z
    let changed = this.root.visible !== show
    this.root.visible = show
    const step = gridStep(ppm).minor
    if (show && step !== this.step) { this.step = step; this.draw(); changed = true }
    return changed
  }

  /** Move the plane, for the exploded view whose lowest group goes below the board. */
  setZ(z: number) { this.root.position.z = z }

  clear() {
    for (const l of this.lines) { l.geometry.dispose(); (l.material as THREE.Material).dispose(); this.root.remove(l) }
    for (const s of [...this.labels.children] as THREE.Sprite[]) { s.material.map?.dispose(); s.material.dispose(); this.labels.remove(s) }
    this.lines = []
  }
}
