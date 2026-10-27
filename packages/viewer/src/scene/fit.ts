// what the 3D fit frames; the grid and anything else outside the board group never counts
import * as THREE from 'three'

/** The box of every child of `board`, each moved `dz(child)` mm in z from where it stands, as the exploded stack will be. */
export function fitBox(board: THREE.Object3D, dz: (child: THREE.Object3D) => number = () => 0): THREE.Box3 {
  board.updateMatrixWorld(true)
  const box = new THREE.Box3()
  for (const c of board.children) {
    const b = new THREE.Box3().setFromObject(c)
    if (!b.isEmpty()) box.union(b.translate(new THREE.Vector3(0, 0, dz(c))))
  }
  return box
}

/** The sphere a camera fit takes from a box; null for an empty one. */
export function fitSphere(box: THREE.Box3): { centre: THREE.Vector3; radius: number } | null {
  return box.isEmpty() ? null : { centre: box.getCenter(new THREE.Vector3()), radius: box.getSize(new THREE.Vector3()).length() / 2 }
}

/** The camera's back, right and top unit vectors looking back along `dir`. */
function axes(dir: THREE.Vector3, up: THREE.Vector3) {
  const back = dir.clone().normalize()
  let right = up.clone().cross(back)
  if (right.lengthSq() < 1e-12) right = new THREE.Vector3(1, 0, 0)
  right.normalize()
  return { back, right, top: back.clone().cross(right) }
}

/** The box's corners relative to its centre. */
function corners(box: THREE.Box3): THREE.Vector3[] {
  const c = box.getCenter(new THREE.Vector3()), out: THREE.Vector3[] = []
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) out.push(new THREE.Vector3(x, y, z).sub(c))
  return out
}

/** How far along `dir` from the box's centre a camera stands so every corner is on screen, `margin` times that; `vfov` in radians. */
export function fitDistance(box: THREE.Box3, dir: THREE.Vector3, up: THREE.Vector3, vfov: number, aspect: number, margin = 1.08): number {
  const { back, right, top } = axes(dir, up)
  const tv = Math.tan(vfov / 2), th = tv * aspect
  let d = 0
  for (const p of corners(box)) {
    const toward = p.dot(back)
    d = Math.max(d, toward + Math.abs(p.dot(right)) / th, toward + Math.abs(p.dot(top)) / tv)
  }
  return d * margin
}

/** A fit that keeps the right `aside` of the screen width, a fraction, free: the distance along `dir` and the target's shift from the box's centre. */
export function fitBeside(box: THREE.Box3, dir: THREE.Vector3, up: THREE.Vector3, vfov: number, aspect: number, aside: number, margin = 1.08): { dist: number; shift: THREE.Vector3 } {
  const { back, right, top } = axes(dir, up)
  const tv = Math.tan(vfov / 2), th = tv * aspect
  // the corners must land between -1 and u in normalised x
  const u = 1 - 2 * Math.max(0, Math.min(0.5, aside))
  const pts = corners(box).map(p => ({ r: p.dot(right), t: p.dot(back), y: p.dot(top) }))
  let d = 0
  for (const p of pts) d = Math.max(d, p.t + Math.abs(p.y) / tv)
  for (const p of pts) for (const q of pts) d = Math.max(d, (p.r - q.r + th * (u * p.t + q.t)) / (th * (1 + u)))
  d *= margin
  const lo = Math.max(...pts.map(p => p.r - u * th * (d - p.t))), hi = Math.min(...pts.map(p => p.r + th * (d - p.t)))
  return { dist: d, shift: right.multiplyScalar((lo + hi) / 2) }
}

/** The box of the board with each stack group at its offset in `off` (mm), overlay with F.SilkS; barrels and other children stay put. */
export function stackBox(board: THREE.Object3D, off: Map<string, number>): THREE.Box3 {
  const at = (c: THREE.Object3D) => (c.name === 'overlay' ? off.get('F.SilkS') : c.name === 'barrels' ? undefined : off.get(c.name))
  return fitBox(board, c => { const z = at(c); return z === undefined ? 0 : z - c.position.z })
}
