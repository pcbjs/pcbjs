// z = 0 the board face, +y the footprint's -y; three pins: 1 and 2 at -x, pin 1 at +y, 3 at +x; five and six: 1 to 3 down -x from +y
import * as THREE from 'three'
import type { ModelSpec } from '@pcbjs/core/types'
import { M } from './materials'
import { chamferedBox, mesh } from './geom'

type SotSpec = Extract<ModelSpec, { kind: 'sot23' }>

const BODY = { w: 1.3, l: 2.9, standoff: 0.1 }
/** The wider body of SOT-23-5 and SOT-23-6, and where their leads end. */
const WIDE = { w: 1.6, reach: 1.4 }

/** A gull-wing lead leaving the body side at x = x0 and ending at x = x1 on the board, extruded across its width. */
function leadGeometry(x0: number, x1: number, zExit: number, width: number, t = 0.12): THREE.BufferGeometry {
  const bend = x0 + 0.18, foot = x0 + 0.32
  const s = new THREE.Shape()
  // the lead's centreline: out of the body, down, then flat on the board; the outline is the line thickened
  s.moveTo(x0 - 0.15, zExit + t / 2)
  s.lineTo(bend + t / 2, zExit + t / 2)
  s.lineTo(foot + t / 2, t)
  s.lineTo(x1, t)
  s.lineTo(x1, 0)
  s.lineTo(foot - t / 2, 0)
  s.lineTo(bend - t / 2, zExit - t / 2)
  s.lineTo(x0 - 0.15, zExit - t / 2)
  s.closePath()
  const g = new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: false })
  g.rotateX(Math.PI / 2) // shape y becomes z, the extrusion runs along -y
  g.translate(0, width / 2, 0)
  return g
}

export function sot23Model(spec: SotSpec, height: number): THREE.Object3D {
  const n = spec.pins === 5 || spec.pins === 6 ? spec.pins : 3
  const w = n === 3 ? BODY.w : WIDE.w
  const top = Math.max(0.6, height)
  const g = new THREE.Group()
  g.add(mesh(chamferedBox(w, BODY.l, top - BODY.standoff, 0.12, BODY.standoff), M.mould))
  const exit = BODY.standoff + (top - BODY.standoff) * 0.4
  const lead = leadGeometry(w / 2, n === 3 ? 1.25 : WIDE.reach, exit, 0.4)
  const pins: [number, number][] = n === 3 ? [[-1, 0.95], [-1, -0.95], [1, 0]]
    : [[-1, 0.95], [-1, 0], [-1, -0.95], [1, -0.95], ...(n === 6 ? [[1, 0] as [number, number]] : []), [1, 0.95]]
  for (const [side, y] of pins) {
    const m = mesh(lead, M.tin, 0, y)
    if (side < 0) m.rotation.z = Math.PI
    g.add(m)
  }
  const dot = new THREE.CircleGeometry(0.14, 24)
  g.add(mesh(dot, M.dimple, -w / 2 + 0.32, BODY.l / 2 - 0.42, top + 0.003))
  return g
}
