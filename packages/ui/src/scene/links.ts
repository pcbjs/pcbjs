// The ratsnest, the selection's connections and the finding lines in the 3D view: one dashed arc each from pad surface to pad surface, a
// stem through the board to a far side or inner layer, the dashes marching by a uniform offset; widths in screen pixels follow the zoom.
import * as THREE from 'three'
import { Line2 } from 'three/addons/lines/Line2.js'
import { LineGeometry } from 'three/addons/lines/LineGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import type { SiteData } from '@pcbjs/core/site-data'
import { connections, curve3, endAt, type Conn, type Stack } from '../indicators'
import { RATS, ratsWidth, type FindingLine, type RatsKind } from '../finding-marks'
import type { Drawn } from '../selection'

// dashes with round caps: LineMaterial's dash test made a capsule in screen pixels, mm along the line per pixel from the derivatives
const DASHES = `
  float mmPx = max( length( vec2( dFdx( vLineDistance ), dFdy( vLineDistance ) ) ), 1e-6 );
  if ( vUv.y < - 1.0 || vUv.y > 1.0 ) discard;
  float along = mod( vLineDistance + dashOffset, dashSize + gapSize ) / mmPx;
  float r = linewidth * 0.5;
  float core = clamp( along, r, max( r, dashSize / mmPx - r ) );
  if ( length( vec2( along - core, vUv.x * r ) ) > r ) discard;
`
const SEVERITY_TOKEN: Record<string, string> = { error: '--drc-err', warning: '--drc-warn', info: '--drc-info' }

/** What the lines are drawn from. */
export interface LinkInput {
  board: SiteData
  /** a route end slot's ratsnest lines, each lit or dimmed; null without one */
  ends: { lit: boolean }[] | null
  lines: readonly FindingLine[]
  ratsnest: boolean
  drawn: Drawn | null
  stack: Stack
  shown(id: string): boolean
  stale(id: string): boolean
  /** a finding line in focus marches */
  focus(line: number): boolean
}
/** The view's scale: its ratsnest zoom, mm per pixel at the target and the pixel ratio. */
export interface LinkScale {
  zoom: number
  mmPx: number
  ratio: number
}

export class Links {
  root: THREE.Group | null = null
  /** each finding line's middle in the board group, for its label */
  mids = new Map<number, THREE.Vector3>()
  private objs: Line2[] = []
  private dashes: LineMaterial[] = []
  private sev = new Map<string, LineMaterial>()
  private scale: LinkScale = { zoom: 1, mmPx: 1, ratio: 1 }
  private resolution = new THREE.Vector2(1, 1)
  private zoomAt = 0
  private dashAt = 0
  private css: (name: string, fallback: string) => string
  constructor(css: (name: string, fallback: string) => string) {
    this.css = css
  }

  /** Every line again under `parent`, at the view's scale. */
  build(parent: THREE.Object3D, d: LinkInput, scale: LinkScale) {
    this.clear()
    this.scale = scale
    const b = d.board
    const plain = d.ratsnest || d.ends ? b.ratsnest : []
    if (!plain.length && !d.lines.length) return
    const root = (this.root = new THREE.Group())
    root.name = 'links'
    const key = (c: Conn) => `${c.net}:${c.a.at.join()}:${c.b.at.join()}`
    const own = new Set(connections(b, d.drawn).map(key))
    const rats = this.dash(this.css('--rats', '#e8c547'), RATS.opacity.plain)
    const accent = this.dash(this.css('--accent', '#6ea8ff'), 1)
    const dim = d.ends ? this.dash(this.css('--rats', '#e8c547'), 0.2) : rats
    const ring = new THREE.RingGeometry(0.25, 0.4, 24)
    const draw = (net: string, from: [number, number], to: [number, number], mat: LineMaterial, line?: number) => {
      const c: Conn = { net, a: endAt(b, from, net), b: endAt(b, to, net) }
      const k = curve3(b, c, d.stack)
      const m3 = mat === rats && own.has(key(c)) ? accent : mat
      for (const pts of k.stem ? [k.arc, k.stem] : [k.arc]) {
        const l = dashed(pts, m3)
        if (line !== undefined) {
          l.userData.line = line
          this.objs.push(l)
        }
        root.add(l)
      }
      if (k.ring) {
        const m = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: m3.color.clone(), side: THREE.DoubleSide }))
        m.position.set(k.ring[0], -k.ring[1], k.ring[2] + (k.under ? -0.01 : 0.01))
        m.userData.pick = false
        root.add(m)
      }
      const mid = k.arc[Math.floor(k.arc.length / 2)]
      return new THREE.Vector3(mid[0], -mid[1], mid[2])
    }
    const carried = new Set(d.lines.flatMap(l => (l.rats === null ? [] : [l.rats])))
    plain.forEach((r, i) => {
      if (d.ends || !carried.has(i)) draw(r.net, r.from, r.to, d.ends ? (d.ends[i].lit ? accent : dim) : rats)
    })
    d.lines.forEach((l, i) => {
      const ids = l.findings.map(f => f.id ?? '')
      if (!ids.some(d.shown)) return
      this.mids.set(i, draw(l.net, l.from, l.to, this.sevMat(l.severity, ids.every(d.stale), d.focus(i)), i))
    })
    parent.add(root)
  }

  /** A line hovered or focused: its pieces swap material, nothing is built again. */
  restyle(d: Pick<LinkInput, 'lines' | 'stale' | 'focus'>) {
    for (const o of this.objs) {
      const l = d.lines[o.userData.line as number]
      if (l)
        o.material = this.sevMat(
          l.severity,
          l.findings.every(f => d.stale(f.id ?? '')),
          d.focus(o.userData.line),
        )
    }
  }

  /** The widths and dashes follow a zoom that moved by more than 3 percent; true when they did. */
  step(scale: LinkScale): boolean {
    this.scale = scale
    if (!this.dashes.length || (this.zoomAt && Math.abs(scale.zoom / this.zoomAt - 1) < 0.03)) return false
    this.zoomAt = scale.zoom
    for (const m of this.dashes) this.style(m)
    return true
  }
  /** Only a line in focus marches, at 20 frames a second; true when one moved. */
  march(now: number): boolean {
    const marching = this.dashes.filter(m => m.userData.kind === 'focus')
    if (!marching.length || now - this.dashAt <= 50) return false
    for (const m of marching) m.dashOffset -= ((now - this.dashAt) / 1000) * (m.dashSize + m.gapSize)
    this.dashAt = now
    return true
  }
  /** The drawing buffer's size, device pixels, as the widths are. */
  resize(v: THREE.Vector2) {
    this.resolution.copy(v)
    for (const m of this.dashes) m.resolution.copy(v)
  }

  /** The finding line under a ray, by its index: the solid line under the dashes at its drawn width, at least RATS.hit px. */
  under(ray: THREE.Raycaster): number | null {
    if (!this.objs.length) return null
    const floor = RATS.hit * this.scale.ratio
    let best: THREE.Intersection | null = null
    for (const o of this.objs) {
      ray.params.Line2 = { threshold: Math.max(0, floor - (o.material as LineMaterial).linewidth) }
      const hit = ray.intersectObject(o, false)[0]
      if (hit && (!best || hit.distance < best.distance)) best = hit
    }
    return best ? (best.object.userData.line as number) : null
  }

  private sevMat(severity: string, stale: boolean, focus: boolean): LineMaterial {
    const k = `${severity}:${stale}:${focus}`
    let m = this.sev.get(k)
    if (!m)
      this.sev.set(
        k,
        (m = this.dash(this.css(SEVERITY_TOKEN[severity] ?? '--drc-warn', '#ff9f1c'), stale ? 0.3 : RATS.opacity[focus ? 'focus' : 'finding'], focus ? 'focus' : 'finding')),
      )
    return m
  }
  /** A dashed line material whose width follows the zoom, as ratsWidth gives it for its kind. */
  private dash(color: string, opacity: number, kind: RatsKind = 'plain'): LineMaterial {
    const m = new LineMaterial({ color: new THREE.Color(color).getHex(), linewidth: 1, dashed: true, dashSize: 1, gapSize: 1, transparent: true, opacity })
    m.userData.kind = kind
    m.onBeforeCompile = sh => {
      sh.fragmentShader = sh.fragmentShader.replace(/if \( vUv\.y < - 1\.0 \|\| vUv\.y > 1\.0 \) discard;[\s\S]*?todo - FIX/, DASHES)
    }
    m.customProgramCacheKey = () => 'rats-dashes'
    m.resolution.copy(this.resolution)
    this.style(m)
    this.dashes.push(m)
    return m
  }
  /** A material's width in device pixels and its dash and gap in mm, RATS.dash and RATS.gap widths long at the current zoom. */
  private style(m: LineMaterial) {
    const { zoom, mmPx, ratio } = this.scale
    const css = ratsWidth(m.userData.kind as RatsKind, zoom)
    m.linewidth = css * ratio
    m.dashSize = RATS.dash * css * mmPx
    m.gapSize = RATS.gap * css * mmPx
  }

  private clear() {
    if (this.root) {
      this.root.parent?.remove(this.root)
      this.root.traverse(o => (o as THREE.Mesh).geometry?.dispose())
    }
    for (const m of this.dashes) m.dispose()
    this.dashes = []
    this.sev = new Map()
    this.root = null
    this.mids = new Map()
    this.objs = []
  }
  dispose() {
    this.clear()
  }
}

function dashed(pts: [number, number, number][], mat: LineMaterial): Line2 {
  const geo = new LineGeometry().setPositions(pts.flatMap(p => [p[0], -p[1], p[2]]))
  const line = new Line2(geo, mat)
  line.computeLineDistances()
  line.userData.pick = false
  line.renderOrder = 5
  return line
}
