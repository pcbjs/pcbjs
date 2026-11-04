// The exploded stack's callouts: a label per layer in one column beside the board, each on a leader from its layer's rightmost outline
// point on screen, and the silk and parts planes drawn as wireframes whose grids follow the ground grid's step.
import * as THREE from 'three'
import { anchor, calloutOpacity, column, leader, type P2 } from './callouts'
import { gridSegs, outlineSegs, type Ring } from './wire'
import type { Callout } from './board-scene'

// px: the column's gap right of the rightmost anchor, a row, the leader's stop short of the label, the room kept at the pane's edge
const GAP = 24,
  ROW = 18,
  STOP = 3,
  EDGE = 12
const WIRE = { outline: 0.75, grid: 0.12 }

interface Label {
  el: HTMLDivElement
  leader: SVGPathElement
  group: string
  z: number
  width: number
  on: boolean
}
interface Wire {
  group: string
  outline: THREE.LineSegments
  grid: THREE.LineSegments
  z: number
}

const flatToXyz = (pts: number[], z: number) => {
  const out: number[] = []
  for (let i = 0; i < pts.length; i += 2) out.push(pts[i], pts[i + 1], z)
  return out
}
function wireLines(pts: number[], z: number, color: string, opacity: number): THREE.LineSegments {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(flatToXyz(pts, z), 3))
  const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }))
  l.userData.opacity = opacity
  l.raycast = () => {}
  return l
}

export class StackLabels {
  private labels: Label[] = []
  private wires: Wire[] = []
  private rings: Ring[] = []
  private hull: P2[] = []
  private step = 0
  private vp = new THREE.Matrix4()
  private host: HTMLElement
  private leaders: SVGSVGElement
  private hover: (group: string | null) => void
  constructor(host: HTMLElement, leaders: SVGSVGElement, hover: (group: string | null) => void) {
    this.host = host
    this.leaders = leaders
    this.hover = hover
  }

  /** The labels and planes of a new board, the planes in their layer groups. */
  build(callouts: readonly Callout[], planes: readonly { group: string; z: number; color: string }[], groups: Map<string, THREE.Group>, hull: P2[], rings: Ring[]) {
    this.clear()
    this.hull = hull
    this.rings = rings
    for (const c of callouts) {
      const el = document.createElement('div')
      el.title = c.title
      el.className = 'view3d-callout'
      el.textContent = c.text
      el.style.setProperty('--c', c.color)
      el.style.display = 'none'
      el.addEventListener('pointerenter', () => this.hover(c.group))
      el.addEventListener('pointerleave', () => this.hover(null))
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      line.style.setProperty('--c', c.color)
      line.style.display = 'none'
      this.host.append(el)
      this.leaders.append(line)
      this.labels.push({ el, leader: line, group: c.group, z: c.z, width: 0, on: false })
    }
    for (const p of planes) {
      const outline = wireLines(outlineSegs(rings), p.z, p.color, WIRE.outline),
        grid = wireLines([], p.z, '#999999', WIRE.grid)
      outline.visible = grid.visible = false
      groups.get(p.group)?.add(outline, grid)
      this.wires.push({ group: p.group, outline, grid, z: p.z })
    }
  }

  /** Whether a group has a callout. */
  has(group: string): boolean {
    return this.labels.some(l => l.group === group)
  }

  /** Each label shown while the stack is open or opening, in the opacity the hovered layer gives it; the planes with them. */
  update(open: boolean, present: boolean, hovered: string | null, shown: (group: string) => boolean) {
    for (const l of this.labels) {
      l.on = present && shown(l.group)
      l.el.classList.toggle('on', l.group === hovered)
      const o = String(calloutOpacity(l.group, hovered, open))
      if (l.el.style.opacity !== o) {
        l.el.style.opacity = o
        l.leader.style.opacity = o
      }
      if (!l.on) l.el.style.display = l.leader.style.display = 'none'
    }
    for (const w of this.wires) {
      w.outline.visible = w.grid.visible = present
      const k = hovered && hovered !== w.group ? 0.4 : 1
      for (const l of [w.outline, w.grid]) (l.material as THREE.LineBasicMaterial).opacity = l.userData.opacity * k
    }
  }

  /** Per frame while the planes show: their grids at the ground grid's step; true when they moved. */
  stepWires(step: number): boolean {
    if (!this.wires.some(w => w.grid.visible) || step === this.step) return false
    this.step = step
    const pts = gridSegs(this.rings, step)
    for (const w of this.wires) w.grid.geometry.setAttribute('position', new THREE.Float32BufferAttribute(flatToXyz(pts, w.z), 3))
    return true
  }

  /** Per drawn frame: each shown label's leader from its layer's rightmost outline point on screen to one column of labels. */
  layout(camera: THREE.Camera, w: number, h: number, groupZ: (group: string) => number) {
    const shown = this.labels.filter(l => l.on)
    if (!shown.length) return
    this.vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    const live: Label[] = [],
      at: P2[] = []
    for (const l of shown) {
      const a = anchor(this.vp.elements, this.hull, groupZ(l.group) + l.z, w, h)
      if (!a) {
        l.el.style.display = l.leader.style.display = 'none'
        continue
      }
      if (l.el.style.display === 'none') l.el.style.display = l.leader.style.display = ''
      live.push(l)
      at.push(a)
    }
    const placed = column(at, ROW, GAP)
    live.forEach((l, i) => {
      const [lx, ly] = placed[i].label
      l.el.style.transform = `translate(${lx.toFixed(1)}px, ${ly.toFixed(1)}px) translateY(-50%)`
      l.leader.setAttribute('d', leader(placed[i], STOP))
    })
  }

  /** The share of a pane `w` px wide the column takes, from its longest label among the shown groups. */
  share(w: number, shown: (group: string) => boolean): number {
    const ls = this.labels.filter(l => shown(l.group))
    if (!w || !ls.length) return 0
    // a label not yet laid out is measured once by hand, or guessed from its text in the 11 px mono face
    const width = (l: Label) => {
      if (!l.width) {
        const d = l.el.style.display
        l.el.style.display = ''
        l.width = l.el.offsetWidth
        l.el.style.display = d
      }
      return l.width || (l.el.textContent ?? '').length * 6.6 + 8
    }
    return (GAP + Math.max(...ls.map(width)) + EDGE) / w
  }

  private clear() {
    for (const l of this.labels) {
      l.el.remove()
      l.leader.remove()
    }
    for (const w of this.wires)
      for (const l of [w.outline, w.grid]) {
        l.parent?.remove(l)
        l.geometry.dispose()
        ;(l.material as THREE.Material).dispose()
      }
    this.labels = []
    this.wires = []
    this.step = 0
  }
  dispose() {
    this.clear()
  }
}
