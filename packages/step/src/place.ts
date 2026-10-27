// 4x4 matrices, column-major as THREE.Matrix4.fromArray reads them, in KiCad's model frame: mm, y along the footprint's -y, z up.
// KiCad's model transform is translate(offset) * Rz(-rz) * Ry(-ry) * Rx(-rx) * scale.
export type Mat4 = number[]
export type Vec3 = [number, number, number]

export interface StepTransform { offset: Vec3; rotate: Vec3; scale: Vec3 }
export interface StepPlacement { at: [number, number]; rot: number; side: 'F' | 'B' }

const DEG = Math.PI / 180

export const identity = (): Mat4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

/** a * b */
export function mul(a: Mat4, b: Mat4): Mat4 {
  const o = new Array(16).fill(0)
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]
    o[c * 4 + r] = s
  }
  return o
}
export const translate = (x: number, y: number, z: number): Mat4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]
export const scale = (x: number, y: number, z: number): Mat4 => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1]
export function rotX(a: number): Mat4 { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1] }
export function rotY(a: number): Mat4 { const c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1] }
export function rotZ(a: number): Mat4 { const c = Math.cos(a), s = Math.sin(a); return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }

/** The point p moved by m. */
export function apply(m: Mat4, p: Vec3): Vec3 {
  return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]]
}

/** KiCad's model transform, in the model frame. */
export function modelMatrix(t: StepTransform): Mat4 {
  const [ox, oy, oz] = t.offset, [rx, ry, rz] = t.rotate, [sx, sy, sz] = t.scale
  return [translate(ox, oy, oz), rotZ(-rz * DEG), rotY(-ry * DEG), rotX(-rx * DEG), scale(sx, sy, sz)].reduce(mul)
}

/** The footprint's placement of its model frame in the scene; `face` is the z of the board face the part sits on. */
export function footprintMatrix(fp: StepPlacement, face: number): Mat4 {
  const m = mul(translate(fp.at[0], -fp.at[1], face), rotZ(fp.rot * DEG))
  return fp.side === 'B' ? mul(m, rotY(Math.PI)) : m
}

/** The whole placement of a STEP model: the footprint's, times the model transform. */
export const stepMatrix = (fp: StepPlacement, t: StepTransform, face: number): Mat4 => mul(footprintMatrix(fp, face), modelMatrix(t))

export interface Box3 { min: Vec3; max: Vec3 }
/** A rectangle in the footprint frame: mm, x right, y down as on the board, as the courtyard is drawn. */
export interface Rect { x0: number; y0: number; x1: number; y1: number }

/** The box around the eight corners of `b` moved by `m`. */
export function transformBox(m: Mat4, b: Box3): Box3 {
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < 8; i++) {
    const p = apply(m, [i & 1 ? b.max[0] : b.min[0], i & 2 ? b.max[1] : b.min[1], i & 4 ? b.max[2] : b.min[2]])
    for (let k = 0; k < 3; k++) { if (p[k] < min[k]) min[k] = p[k]; if (p[k] > max[k]) max[k] = p[k] }
  }
  return { min, max }
}

/** The extent of a model in the footprint frame, x right and y down, from its mesh bounds and its KiCad transform. */
export function footprintRect(bounds: Box3, t: StepTransform): Rect {
  const b = transformBox(modelMatrix(t), bounds)
  // the model's y is the footprint's -y
  return { x0: b.min[0], y0: -b.max[1], x1: b.max[0], y1: -b.min[1] }
}

const r1 = (v: number) => (Math.round(v * 10) / 10).toFixed(1)

/** The footprint's declared body height and whether it has drilled pads. */
export interface PlacementFootprint { height?: number; tht?: boolean }

/** Why a placed model looks wrong against its footprint and courtyard, `tol` in mm, or null when it fits. */
export function placementIssue(bounds: Box3, t: StepTransform, courtyard: Rect, tol = 1, fp: PlacementFootprint = {}): string | null {
  if (!Number.isFinite(bounds.min[0]) || !Number.isFinite(bounds.max[0])) return 'the model has no geometry'
  const m = footprintRect(bounds, t)
  const mw = m.x1 - m.x0, mh = m.y1 - m.y0, cw = courtyard.x1 - courtyard.x0, ch = courtyard.y1 - courtyard.y0
  const out: [string, number][] = [['-x', courtyard.x0 - m.x0], ['+x', m.x1 - courtyard.x1], ['-y', courtyard.y0 - m.y0], ['+y', m.y1 - courtyard.y1]]
  const worst = out.reduce((a, c) => (c[1] > a[1] ? c : a))
  if (worst[1] > tol) {
    const sides = out.filter(o => o[1] > tol).map(o => o[0]).join(' ')
    return `model box reaches ${r1(worst[1])} mm past the courtyard at ${sides}`
  }
  if (cw > 0.5 && ch > 0.5 && mw < cw / 5 && mh < ch / 5) return `model is ${r1(mw)} x ${r1(mh)} mm on a ${r1(cw)} x ${r1(ch)} mm courtyard: wrong units?`
  const b = transformBox(modelMatrix(t), bounds)
  const top = b.max[2], bottom = b.min[2]
  if (top <= 0.05) return `model is under the board face, its top at ${r1(top)} mm: sunk into the board?`
  if (!fp.tht && bottom < -0.2) return `model reaches ${r1(-bottom)} mm into the board: sunk into the board?`
  const h = fp.height
  if (h !== undefined && h > 0 && !heightAgrees(top, h)) {
    const side = [mw, mh].find(v => heightAgrees(v, h))
    if (side !== undefined && top > h) return `model is ${r1(top)} mm tall where the footprint declares ${r1(h)} mm, and ${r1(side)} mm across: lying on its side?`
    return `model is ${r1(top)} mm tall where the footprint declares ${r1(h)} mm`
  }
  return null
}

/** True when a model height and a footprint's declared height agree within a factor of 1.6, a few tenths of a mm aside. */
export const heightAgrees = (model: number, declared: number): boolean => Math.abs(Math.log((model + 0.3) / (declared + 0.3))) <= Math.log(1.6)
