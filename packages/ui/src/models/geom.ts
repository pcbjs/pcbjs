// every geometry is in millimetres
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'

/** A box with rounded edges, its base on z = z0. */
export function roundedBox(w: number, h: number, d: number, r: number, z0 = 0): THREE.BufferGeometry {
  const g = new RoundedBoxGeometry(w, h, d, 2, Math.max(0.001, Math.min(r, w / 2, h / 2, d / 2) * 0.999))
  g.translate(0, 0, z0 + d / 2)
  return g
}

/** A box with chamfered top and bottom edges, from z = z0 to z0 + d. */
export function chamferedBox(w: number, h: number, d: number, c: number, z0 = 0): THREE.BufferGeometry {
  c = Math.min(c, w / 3, h / 3, d / 3)
  const s = new THREE.Shape()
  const x = w / 2 - c,
    y = h / 2 - c
  s.moveTo(-x, -y)
  s.lineTo(x, -y)
  s.lineTo(x, y)
  s.lineTo(-x, y)
  s.closePath()
  const g = new THREE.ExtrudeGeometry(s, { depth: d - 2 * c, bevelEnabled: true, bevelThickness: c, bevelSize: c, bevelSegments: 1 })
  g.translate(0, 0, z0 + c)
  return g
}

/** A plain box, its base on z = z0. */
export function box(w: number, h: number, d: number, x = 0, y = 0, z0 = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d)
  g.translate(x, y, z0 + d / 2)
  return g
}

export function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat)
  m.position.set(x, y, z)
  return m
}
