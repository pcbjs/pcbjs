// rows along x, pins along y with pin 1 at +y; z = 0 is the board face
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { ModelSpec } from '@pcbjs/core/types'
import { M } from './materials'
import { chamferedBox, mesh } from './geom'

type HeaderSpec = Extract<ModelSpec, { kind: 'header' }>

/** A square pin from z0 to z1 with pyramid tips at both ends. */
function pinGeometry(s: number, z0: number, z1: number): THREE.BufferGeometry {
  const tip = s * 0.45
  const shaft = new THREE.BoxGeometry(s, s, z1 - z0 - 2 * tip).toNonIndexed()
  shaft.translate(0, 0, (z0 + z1) / 2)
  const end = (z: number, up: boolean) => {
    const c = new THREE.CylinderGeometry(up ? s * 0.22 : (s / Math.SQRT2), up ? s / Math.SQRT2 : s * 0.22, tip, 4, 1).toNonIndexed()
    c.rotateY(Math.PI / 4)
    c.rotateX(Math.PI / 2)
    c.translate(0, 0, z)
    c.computeVertexNormals()
    return c
  }
  const parts = [shaft, end(z1 - tip / 2, true), end(z0 + tip / 2, false)]
  for (const p of parts) p.deleteAttribute('uv')
  return mergeGeometries(parts)!
}

export function headerModel(spec: HeaderSpec, height: number, thickness: number): THREE.Object3D {
  const { pins, rows, pitch } = spec
  const plastic = pitch >= 2.5 ? 2.54 : pitch >= 1.9 ? 1.5 : 1.0
  const s = pitch >= 2.5 ? 0.64 : pitch >= 1.9 ? 0.5 : 0.4
  const above = spec.pinLength ?? Math.max(1, height - plastic)
  const tail = 3
  const g = new THREE.Group()
  const block = chamferedBox(pitch - 0.08, pitch - 0.08, plastic, Math.min(0.25, pitch * 0.1))
  const pin = pinGeometry(s, -thickness - tail, plastic + above)
  for (let i = 0; i < pins; i++)
    for (let r = 0; r < rows; r++) {
      const x = (r - (rows - 1) / 2) * pitch, y = ((pins - 1) / 2 - i) * pitch
      g.add(mesh(block, M.plastic, x, y))
      g.add(mesh(pin, M.gold, x, y))
    }
  return g
}
