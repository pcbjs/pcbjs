import type { Pt, Ring, Board, Footprint, MatePoint, Pad } from '@pcbjs/core/model'
import type { Src, StepModelSpec } from '@pcbjs/core/internal/types'
import { isFileModel } from '@pcbjs/core/internal/model-source'
import type { BoardReference, HeightSource, Mat4, ReferencedBoard, ReferencedFootprint, ReferenceResolver, ReferenceStack, ReferencePose } from '@pcbjs/core/internal/reference'
import { isPinRef } from '@pcbjs/core/internal/nets'
import { partOf, pinOfPad, type PartState } from '@pcbjs/core/internal/part'
import { mm } from '@pcbjs/core/internal/units'
import { area, clipRings, type Mat } from './geom.js'
import { CompileError, type MateJob } from './flatten.js'
import { bareHole } from './bare.js'

export type { ReferenceResolver }

/** The box of a model file in the footprint frame, z up from the board face, its transform applied; null when not known. */
export type ModelBoxLoader = (model: StepModelSpec) => { min: [number, number, number]; max: [number, number, number] } | null

/** The top of a footprint's model file above the board face, from the loader's box; null without a file, a loader or a box above the face. */
export function modelTop(fp: Footprint, load?: ModelBoxLoader): number | null {
  const m = fp.model as StepModelSpec | undefined
  if (!load || !isFileModel(m) || !m.path) return null
  let box: ReturnType<ModelBoxLoader> = null
  try {
    box = load(m)
  } catch {
    return null
  }
  const top = box?.max?.[2]
  return typeof top === 'number' && Number.isFinite(top) && top > 0 ? Math.round(top * 1000) / 1000 : null
}

/** A part's body height for the reference checks: its `height`, else its model's top, else 0 for a bare hole and 1 mm otherwise. */
export function bodyHeight(board: Board, fp: Footprint, load?: ModelBoxLoader): { height: number; from: HeightSource } {
  if (fp.height !== undefined) return { height: fp.height, from: 'height' }
  const top = modelTop(fp, load)
  if (top !== null) return { height: top, from: 'model' }
  return bareHole(board, fp) ? { height: 0, from: 'bare' } : { height: 1, from: 'default' }
}

/** A reference() element as flatten found it: its props, the frame of the groups around it and where it was written. */
export interface ReferenceJob {
  props: Record<string, any>
  m: Mat
  src?: Src
}

import { CompileError as ReferenceError, PART_REFS } from './flatten.js'
import { CycleError } from './deps.js'

// 4x4 matrices, column-major, as @pcbjs/step/place and THREE.Matrix4
const DEG = Math.PI / 180
export function mul4(a: Mat4, b: Mat4): Mat4 {
  const o = new Array(16).fill(0)
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let s = 0
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]
      o[c * 4 + r] = s
    }
  return o
}
const chain4 = (...ms: Mat4[]): Mat4 => ms.reduce(mul4)
export const translate4 = (x: number, y: number, z: number): Mat4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]
export function rotZ4(a: number): Mat4 {
  const c = Math.cos(a),
    s = Math.sin(a)
  return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
}
/** a turn over about the y axis, half a turn: x and z change sign */
export const TURN: Mat4 = [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1]
export const IDENTITY4: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
/** The inverse of a rigid motion: the transposed rotation and the translation taken back. */
export function invertRigid(m: Mat4): Mat4 {
  const r = [m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0, 0, 0, 0, 1]
  const t = apply4(r, [m[12], m[13], m[14]])
  r[12] = -t[0]
  r[13] = -t[1]
  r[14] = -t[2]
  return r
}
export function apply4(m: Mat4, p: [number, number, number]): [number, number, number] {
  return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]]
}
const clean = (m: Mat4): Mat4 => m.map(v => (Math.abs(v) < 1e-12 ? 0 : Math.round(v * 1e9) / 1e9))
/** A board point of the referenced board at height z, through the transform, as a point of this board: mm, y down. */
export const toBoard = (w: Mat4, p: Pt, z = 0): Pt => {
  const q = apply4(w, [p[0], -p[1], z])
  return [q[0], -q[1]]
}

/** A pin's frame in the 3D view: on the part's face, x along the part, z out of the face; a back part turned over about y. */
export function pinFrame(side: 'F' | 'B', rot: number, pin: Pt, thickness: number): Mat4 {
  const m = mul4(translate4(pin[0], -pin[1], side === 'F' ? thickness : 0), rotZ4(rot * DEG))
  return side === 'B' ? mul4(m, TURN) : m
}

export interface MateGeometry {
  local: { side: 'F' | 'B'; rot: number; pin: Pt; thickness: number }
  remote: { side: 'F' | 'B'; rot: number; pin: Pt; thickness: number }
  stack: ReferenceStack
  gap: number
  rotate: number
  offset: [number, number, number]
}

/** The mate: the remote pin frame put on the local one, turned over to face it `gap` apart for above and below, in plane for coplanar, then `rotate` and `offset`. */
export function mateTransform(g: MateGeometry): Mat4 {
  const { local: L, remote: R } = g
  let w: Mat4
  if (g.stack === 'coplanar') {
    const ang = (s: 'F' | 'B', rot: number) => (rot + (s === 'B' ? 180 : 0)) * DEG
    w = chain4(translate4(L.pin[0], -L.pin[1], 0), rotZ4(ang(L.side, L.rot) - ang(R.side, R.rot)), translate4(-R.pin[0], R.pin[1], 0))
  } else {
    const facing: ReferenceStack = L.side === 'F' ? 'above' : 'below'
    let pl = pinFrame(L.side, L.rot, L.pin, L.thickness)
    if (g.stack !== facing) {
      pl = mul4(pl, TURN)
      pl[14] = L.side === 'F' ? 0 : L.thickness
    }
    w = chain4(pl, translate4(0, 0, g.gap), TURN, invertRigid(pinFrame(R.side, R.rot, R.pin, R.thickness)))
  }
  const fix = chain4(translate4(g.offset[0], -g.offset[1], g.offset[2]), translate4(L.pin[0], -L.pin[1], 0), rotZ4(g.rotate * DEG), translate4(-L.pin[0], L.pin[1], 0))
  return clean(mul4(fix, w))
}

/** The anchor form: the referenced board's origin at x, y of the group frame `m`, its bottom face at z, or turned over with flip and its top face at z. */
export function anchorTransform(m: Mat, at: [number, number, number], rotate: number, flip: boolean, offset: [number, number, number], thickness = 0): Mat4 {
  return clean(
    chain4(
      translate4(offset[0], -offset[1], offset[2]),
      groupFrame(m),
      translate4(at[0], -at[1], at[2]),
      rotZ4(rotate * DEG),
      flip ? mul4(TURN, translate4(0, 0, -thickness)) : IDENTITY4,
    ),
  )
}

const groupFrame = (m: Mat): Mat4 => [m[0], -m[1], 0, 0, -m[2], m[3], 0, 0, 0, 0, 1, 0, m[4], -m[5], 0, 1]

export function referencePose(value: unknown, src?: Src): ReferencePose {
  const fail = (message: string): never => {
    throw new ReferenceError(`pose: ${message}`, src)
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('expected { translation: [x, y, z], orientation: [x, y, z, w] }')
  const p = value as Record<string, unknown>
  for (const key of Object.keys(p)) if (key !== 'translation' && key !== 'orientation') fail(`unknown field ${JSON.stringify(key)}`)
  if (!Array.isArray(p.translation) || p.translation.length !== 3) return fail('translation must have three lengths')
  const translation = Array.from(p.translation, v => len(v, 'pose.translation', src) || 0) as [number, number, number]
  const q = p.orientation
  if (!Array.isArray(q) || q.length !== 4 || !Array.from(q).every(v => typeof v === 'number' && Number.isFinite(v)))
    return fail('orientation must be four finite numbers [x, y, z, w]')
  const scale = Math.max(...q.map(Math.abs))
  if (!scale) return fail('orientation must be a nonzero quaternion')
  const scaled = q.map(v => v / scale)
  const norm = Math.hypot(...scaled)
  const sign = (q[3] || q[0] || q[1] || q[2]) < 0 ? -1 : 1
  return { translation, orientation: scaled.map(v => (v === 0 ? 0 : (v / norm) * sign)) as [number, number, number, number] }
}

/** T · Q, followed by the enclosing groups; pose translations already use the right-handed 3D frame. */
export function poseTransform(m: Mat, pose: ReferencePose): Mat4 {
  const [x, y, z, w] = pose.orientation
  const rotation = [
    1 - 2 * (y * y + z * z),
    2 * (x * y + z * w),
    2 * (x * z - y * w),
    0,
    2 * (x * y - z * w),
    1 - 2 * (x * x + z * z),
    2 * (y * z + x * w),
    0,
    2 * (x * z + y * w),
    2 * (y * z - x * w),
    1 - 2 * (x * x + y * y),
    0,
    0,
    0,
    0,
    1,
  ]
  return clean(chain4(groupFrame(m), translate4(...pose.translation), rotation))
}

const len = (v: unknown, what: string, src?: Src): number => {
  try {
    const x = mm(v as any)
    if (Number.isFinite(x)) return x
  } catch {
    /* reported below */
  }
  throw new ReferenceError(`${what} must be a length, got ${JSON.stringify(v)}`, src)
}
const triple = (v: unknown, what: string, src?: Src): [number, number, number] => {
  if (!Array.isArray(v) || v.length < 2 || v.length > 3) throw new ReferenceError(`${what} must be [x, y] or [x, y, z] in mm, got ${JSON.stringify(v)}`, src)
  return [len(v[0], what, src), len(v[1], what, src), v[2] === undefined ? 0 : len(v[2], what, src)]
}
const KNOWN = new Set(['path', 'file', 'from', 'pose', 'mate', 'side', 'stack', 'gap', 'at', 'flip', 'rotate', 'offset', 'show'])

/** The board's named points at the poses their parts have now; a name twice is a compile error. */
export function matePoints(jobs: readonly MateJob[]): MatePoint[] {
  const seen = new Map<string, MateJob>()
  return jobs.map(j => {
    const prev = seen.get(j.name)
    if (prev)
      throw new CompileError(
        `two named points are called ${j.name}${prev.src ? `, at ${prev.src.file}:${prev.src.line}` : ''}${j.src ? ` and at ${j.src.file}:${j.src.line}` : ''}`,
        j.src,
      )
    seen.set(j.name, j)
    const pose = 'fp' in j ? { at: j.fp.at, rot: j.fp.rot, side: j.fp.side, ref: j.fp.ref } : { at: j.at, rot: j.rot, side: j.side }
    return { name: j.name, ...pose, ...(j.src ? { src: j.src } : {}) }
  })
}

/** The short name of an entry for a message: its directory for a pcb.tsx, else its file name without the extension. */
export function entryLabel(file: string): string {
  const parts = file.split(/[\\/]/)
  const base = parts.at(-1) ?? file
  return /^pcb\.[cm]?[jt]sx?$/.test(base) && parts.length > 1 ? parts.at(-2)! : base.replace(/\.[cm]?[jt]sx?$/, '')
}

/** Every reference of a flattened board resolved: compiled through `resolver`, placed, and in this board's frame. */
export function resolveReferences(jobs: ReferenceJob[], board: Board, resolver: ReferenceResolver | undefined, load?: ModelBoxLoader): BoardReference[] {
  const partRefs = PART_REFS.get(board) ?? new Map<PartState, string>()
  const heights = board.footprints.map(fp => ({ ref: fp.ref, ...bodyHeight(board, fp, load) }))
  return jobs.map(j => resolveOne(j, board, partRefs, resolver, heights))
}

type Heights = BoardReference['heights'] & {}

const MATE_KEYS = new Set(['local', 'remote', 'pin', 'nets'])

/** A remote net name, or a non-empty list of them. */
const remoteNames = (v: unknown): boolean => typeof v === 'string' || (Array.isArray(v) && v.length > 0 && v.every(x => typeof x === 'string'))

/** The remote net name each local net name wants across the mate, from `mate.nets`; null when the nets are not checked. */
function netMap(nets: unknown, fail: (m: string) => never): ((n: string) => string | string[]) | null {
  if (nets === undefined || nets === false) return null
  if (nets === true) return n => n
  if (typeof nets === 'function') {
    return n => {
      const r = (nets as (n: string) => unknown)(n)
      if (!remoteNames(r)) fail(`mate.nets returned ${JSON.stringify(r)} for ${JSON.stringify(n)}; it must return the remote net name or a list of them`)
      return r as string | string[]
    }
  }
  if (nets && typeof nets === 'object' && !Array.isArray(nets)) {
    const map = nets as Record<string, unknown>
    for (const [k, v] of Object.entries(map))
      if (!remoteNames(v)) fail(`mate.nets maps ${JSON.stringify(k)} to ${JSON.stringify(v)}; each value must be the remote net name or a list of them`)
    return n => (Object.hasOwn(map, n) ? (map[n] as string | string[]) : n)
  }
  return fail(`mate.nets must be true, an object of local to remote net names, or a function of the local name, got ${JSON.stringify(nets)}`)
}

function resolveOne(j: ReferenceJob, board: Board, partRefs: Map<PartState, string>, resolver: ReferenceResolver | undefined, heights: Heights): BoardReference {
  const p = j.props,
    src = j.src
  const label = `reference(${JSON.stringify(p.path)})`
  const fail = (msg: string): never => {
    throw new ReferenceError(`${label}: ${msg}`, src)
  }
  for (const k of Object.keys(p))
    if (!KNOWN.has(k) && k !== '__src') fail(`unknown option ${JSON.stringify(k)}; it takes pose, mate, side, stack, gap, at, flip, rotate, offset and show`)
  if (p.pose !== undefined)
    for (const k of ['mate', 'side', 'stack', 'gap', 'at', 'flip', 'rotate', 'offset']) if (p[k] !== undefined) fail(`pose is a complete placement; do not combine it with ${k}`)
  if (p.mate !== undefined && p.at !== undefined) fail('takes mate or at, not both')
  if (p.mate === undefined && p.at === undefined && p.pose === undefined) fail('needs mate, a mating pair of connectors, at, an anchor [x, y, z], or pose')
  if (!resolver) fail('references compile through the pcbjs command line; a compile of your own passes CompileOptions.references')
  const file = String(p.file ?? p.path)
  let rb: ReferencedBoard
  try {
    rb = resolver!.resolve(file, src, p.from)
  } catch (e) {
    const c = e as CycleError
    if (c?.name === 'CycleError') throw new CycleError(c.code, c.members, `${label}: ${c.prefix}`, src)
    return fail(String((e as Error)?.message ?? e))
  }
  const show = p.show ?? {}
  if (typeof show !== 'object') fail('show must be { outline, bodies, opacity, color }')
  const opacity = show.opacity ?? 0.5
  if (!(typeof opacity === 'number' && opacity >= 0 && opacity <= 1)) fail(`show.opacity must be a number from 0 to 1, got ${JSON.stringify(show.opacity)}`)
  const outlineLayer = show.outline === false ? null : String(show.outline ?? 'Dwgs.User')
  if (outlineLayer && !board.layers.some(l => l.id === outlineLayer))
    fail(`show.outline names ${JSON.stringify(outlineLayer)}, which is not a layer of this board; Dwgs.User is the default`)
  const rotate = p.rotate === undefined ? 0 : Number(p.rotate)
  if (!Number.isFinite(rotate)) fail(`rotate must be degrees, got ${JSON.stringify(p.rotate)}`)
  const offset = p.offset === undefined ? ([0, 0, 0] as [number, number, number]) : triple(p.offset, `${label}: offset`, src)
  const base = {
    entry: rb.entry,
    path: String(p.path),
    name: rb.name,
    title: rb.title,
    hash: rb.hash,
    ...(rb.mesh ? { mesh: rb.mesh } : {}),
    ...(rb.split !== undefined ? { split: rb.split } : {}),
    status: rb.status,
    rotate,
    offset,
    show: { outline: outlineLayer, bodies: show.bodies !== false, opacity, color: String(show.color ?? '#7fb2ff') },
    files: [...rb.files],
    ...(src ? { src } : {}),
  }
  let transform: Mat4
  let ref: Pick<BoardReference, 'anchor' | 'stack' | 'gap' | 'gapFrom' | 'flip' | 'mate' | 'mates'>
  if (p.pose !== undefined) {
    let pose: ReferencePose
    try {
      pose = referencePose(p.pose, src)
    } catch (e) {
      return fail((e as Error).message)
    }
    transform = poseTransform(j.m, pose)
    ref = { anchor: { kind: 'pose', pose } }
  } else if (p.mate !== undefined) {
    // the first pair places the board, every one is checked
    const list: any[] = Array.isArray(p.mate) ? p.mate : [p.mate]
    if (!list.length) fail('mate needs at least one pair { local, remote, pin }')
    const pairs = list.map((m, i) => {
      const what = list.length > 1 ? `mate[${i}]` : 'mate'
      if (!m || typeof m !== 'object' || Array.isArray(m)) fail(`${what} must be { local, remote, pin, nets }`)
      for (const k of Object.keys(m)) if (!MATE_KEYS.has(k)) fail(`${what} has an unknown option ${JSON.stringify(k)}; it takes local, remote, pin and nets`)
      // a pair without its own nets takes the first pair's
      const want = netMap(m.nets !== undefined ? m.nets : list[0]?.nets, fail)
      const local = localPin(m.local, m.pin, board, partRefs, heights, fail)
      if (typeof m.remote !== 'string' || !m.remote) fail(`${what}.remote must be the ref of the mating part on the other board, such as 'J1', or a point it names`)
      const point = rb.mates?.find(q => q.name === m.remote)
      if (point) return { local, rfp: pointPart(rb, point), rpad: { num: '', name: point.name, at: point.at }, want, point }
      const rfp = rb.footprints.find(f => f.ref === m.remote)
      if (!rfp) fail(`${rb.name} has no part ${m.remote}${rb.mates?.length ? ` and no point of that name; its points are ${rb.mates.map(q => q.name).join(', ')}` : ''}`)
      const pinKey = String(m.pin ?? (isPinRef(m.local) ? '' : '1')) || '1'
      const rpad = rfp!.pads.find(q => q.num === pinKey) ?? rfp!.pads.find(q => q.name === pinKey)
      if (!rpad) fail(`${rb.name} ${m.remote} has no pin ${pinKey}; its pads are ${[...new Set(rfp!.pads.map(q => q.num))].join(', ')}`)
      return { local, rfp: rfp!, rpad: rpad!, want, point: undefined }
    })
    if (p.flip !== undefined) fail('flip goes with at; a mate turns the board by its side')
    if (p.stack !== undefined && p.stack !== 'coplanar')
      fail(`stack takes 'coplanar' only; the board lies over the side of the local part, or the side given, side: 'F' or 'B', got ${JSON.stringify(p.stack)}`)
    if (p.side !== undefined && p.side !== 'F' && p.side !== 'B') fail(`side must be 'F' or 'B', got ${JSON.stringify(p.side)}`)
    if (p.side !== undefined && p.stack === 'coplanar') fail("side goes with a stacked board; a coplanar one lies in this board's plane")
    const { local, rfp, rpad, point } = pairs[0]
    const stack: ReferenceStack = p.stack === 'coplanar' ? 'coplanar' : (p.side ?? local.fp.side) === 'B' ? 'below' : 'above'
    const gap = p.gap === undefined ? local.height : len(p.gap, `${label}: gap`, src)
    const gapFrom = p.gap === undefined ? local.from : 'gap'
    if (stack !== 'coplanar' && gap < 0) fail(`gap must not be negative, got ${gap}`)
    const t = mateTransform({
      local: { side: local.fp.side, rot: local.fp.rot, pin: local.pad.at, thickness: board.thickness },
      remote: point ? { side: point.side, rot: point.rot, pin: point.at, thickness: rb.thickness } : { side: rfp.side, rot: rfp.rot, pin: rpad.at, thickness: rb.thickness },
      stack,
      gap,
      rotate,
      offset,
    })
    transform = t
    const mates = pairs.map(({ local: l, rfp: f, rpad: r, want, point: pt }) => {
      const face = f.side === 'F' ? rb.thickness : 0
      return {
        local: { ref: l.fp.ref, pin: l.pad.num, pads: l.pads.map(q => ({ num: q.num, at: q.at, ...(want && q.net ? { net: q.net, want: want(q.net) } : {}) })) },
        remote: { ref: pt ? pt.name : f.ref, pin: r.num, pads: f.pads.map(q => ({ num: q.num, at: toBoard(t, q.at, face), ...(want && q.net ? { net: q.net } : {}) })) },
        ...(want ? { nets: true } : {}),
      }
    })
    ref = {
      anchor: { kind: 'mate', local: `${local.fp.ref}/${local.pad.num}`, remote: point ? point.name : `${rfp.ref}/${rpad.num}` },
      stack,
      ...(stack !== 'coplanar' ? { gap, gapFrom } : {}),
      mate: mates[0],
      ...(mates.length > 1 ? { mates } : {}),
    }
  } else {
    for (const k of ['side', 'stack', 'gap'] as const) if (p[k] !== undefined) fail(`${k} goes with mate; at places the board by its origin`)
    const at = triple(p.at, `${label}: at`, src)
    if (p.flip !== undefined && typeof p.flip !== 'boolean') fail('flip must be true or false')
    transform = anchorTransform(j.m, at, rotate, !!p.flip, offset, rb.thickness)
    ref = { anchor: { kind: 'at', at }, ...(p.flip ? { flip: true } : {}) }
  }
  const slab = projectPrism(rb.outline, 0, rb.thickness, transform)
  const bodies = rb.footprints.filter(f => f.height > 0).map(f => ({ ...body(f, rb.thickness, transform), height: f.height, ...(f.heightFrom ? { from: f.heightFrom } : {}) }))
  const solids = [slab, ...bodies.map(b => ({ outline: [b.ring], z: b.z }))]
  const bounds = solidBounds(solids)
  const tilted = isTilted(transform)
  return {
    ...base,
    ...ref,
    transform,
    heights,
    outline: slab.outline,
    z: slab.z,
    ...(bounds ? { bounds } : {}),
    holes: tilted ? [] : rb.drills.map(d => placedDrill(transform, d)),
    ...(tilted ? { holeOutlines: rb.drills.flatMap(d => projectPrism([drillRing(d)], 0, rb.thickness, transform).outline) } : {}),
    bodies,
  }
}

const isTilted = (w: Mat4): boolean => [w[2], w[6], w[8], w[9]].some(v => Math.abs(v) > 1e-9)

/** The exact XY silhouette and full Z extent of an extruded polygon; their product is a conservative collision prism. */
function projectPrism(rings: Ring[], z0: number, z1: number, w: Mat4): { outline: Ring[]; z: [number, number] } {
  const bottom = rings.map(r => r.map(p => toBoard(w, p, z0)))
  const z: [number, number] = [Infinity, -Infinity]
  for (const ring of rings)
    for (const [x, y] of ring)
      for (const height of [z0, z1]) {
        const value = apply4(w, [x, -y, height])[2]
        z[0] = Math.min(z[0], value)
        z[1] = Math.max(z[1], value)
      }
  if (!Number.isFinite(z[0])) {
    const a = apply4(w, [0, 0, z0])[2],
      b = apply4(w, [0, 0, z1])[2]
    z[0] = Math.min(a, b)
    z[1] = Math.max(a, b)
  }
  if (!isTilted(w)) return { outline: bottom, z }
  const top = rings.map(r => r.map(p => toBoard(w, p, z1)))
  const walls = bottom.flatMap((r, k) =>
    r.map((p, i) => {
      const j = (i + 1) % r.length
      const wall = [p, r[j], top[k][j], top[k][i]]
      return area([wall]) < 0 ? wall.reverse() : wall
    }),
  )
  return { outline: clipRings('union', clipRings('union', bottom, top), walls), z }
}

function solidBounds(solids: { outline: Ring[]; z: [number, number] }[]): BoardReference['bounds'] {
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (const solid of solids)
    for (const ring of solid.outline)
      for (const [x, y] of ring) {
        min[0] = Math.min(min[0], x)
        min[1] = Math.min(min[1], y)
        min[2] = Math.min(min[2], solid.z[0])
        max[0] = Math.max(max[0], x)
        max[1] = Math.max(max[1], y)
        max[2] = Math.max(max[2], solid.z[1])
      }
  return Number.isFinite(min[0]) ? { min, max } : undefined
}

function drillRing(d: ReferencedBoard['drills'][number]): Ring {
  const angle = (d.a ?? 0) * DEG,
    half = Math.max(0, (d.len ?? d.d) - d.d) / 2
  return Array.from({ length: 64 }, (_, i) => {
    const a = (i * Math.PI) / 32,
      x = (Math.cos(a) * d.d) / 2 + (Math.cos(a) >= 0 ? half : -half),
      y = (Math.sin(a) * d.d) / 2
    return [d.x + x * Math.cos(angle) - y * Math.sin(angle), d.y + x * Math.sin(angle) + y * Math.cos(angle)]
  })
}

/** A drill of the referenced board on this one; a slot's axis turns with the board. */
function placedDrill(w: Mat4, d: ReferencedBoard['drills'][number]): BoardReference['holes'][number] {
  const [x, y] = toBoard(w, [d.x, d.y])
  if (d.len === undefined || d.a === undefined) return { x, y, d: d.d }
  const r = (d.a * Math.PI) / 180,
    tip = toBoard(w, [d.x + Math.cos(r), d.y + Math.sin(r)])
  const a = ((((Math.atan2(tip[1] - y, tip[0] - x) * 180) / Math.PI) % 180) + 180) % 180
  return { x, y, d: d.d, len: d.len, a: Math.round(a * 1e4) / 1e4 }
}

/** The part a named point sits on, for the pads the net check pairs; a `<mate>` point has none. */
function pointPart(rb: ReferencedBoard, pt: MatePoint): ReferencedFootprint {
  const fp = pt.ref ? rb.footprints.find(f => f.ref === pt.ref) : undefined
  return fp ?? { ref: pt.name, at: pt.at, rot: pt.rot, side: pt.side, height: 0, body: { x: pt.at[0], y: pt.at[1], w: 0, h: 0, rot: pt.rot }, pads: [] }
}

/** A part's body as a prism in this board's frame: the box corners through the transform, the z range of its two faces. */
function body(f: ReferencedFootprint, thickness: number, w: Mat4): { ref: string; ring: Ring; z: [number, number] } {
  const a = (f.body.rot * Math.PI) / 180,
    u: Pt = [Math.cos(a), -Math.sin(a)],
    v: Pt = [Math.sin(a), Math.cos(a)]
  const corner = (sx: number, sy: number): Pt => [
    f.body.x + (sx * f.body.w * u[0]) / 2 + (sy * f.body.h * v[0]) / 2,
    f.body.y + (sx * f.body.w * u[1]) / 2 + (sy * f.body.h * v[1]) / 2,
  ]
  const z0 = f.side === 'F' ? thickness : -f.height,
    z1 = f.side === 'F' ? thickness + f.height : 0
  const ring = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)]
  const projected = projectPrism([ring], z0, z1, w)
  return { ref: f.ref, ring: projected.outline[0] ?? [], z: projected.z }
}

/** The local part and pad of a mate: a part, which mates at `pin`, or a pin or pad handle. */
function localPin(local: unknown, pin: unknown, board: Board, partRefs: Map<PartState, string>, heights: Heights, fail: (m: string) => never) {
  const st = isPinRef(local) ? partOf(local.part) : partOf(local)
  if (!st)
    fail(`mate.local must be a part of this board, a pin handle such as J1[19], or a part of a group, got ${typeof local === 'string' ? JSON.stringify(local) : typeof local}`)
  const ref = partRefs.get(st!)
  const fp = ref === undefined ? undefined : board.footprints.find(f => f.ref === ref)
  if (!fp) fail(`mate.local, ${st!.label}, is not placed on this board`)
  const pads = fp!.pads.map(id => board.items[id - 1]).filter((it): it is Pad => it?.kind === 'pad')
  let pad: Pad | undefined
  if (isPinRef(local)) {
    if (local.pad !== undefined) pad = pads.find(q => q.num === local.pad) ?? pads.find(q => q.name === local.pad)
    else pad = pads.find(q => pinOfPad(st!.pins, q) === local.pin) ?? pads.find(q => q.num === local.pin)
  } else {
    const key = String(pin ?? 1)
    pad = pads.find(q => q.num === key) ?? pads.find(q => q.name === key) ?? pads.find(q => pinOfPad(st!.pins, q) === key)
  }
  if (!pad) fail(`${fp!.ref} has no pad for the mating pin ${isPinRef(local) ? (local.pad ?? local.pin) : String(pin ?? 1)}`)
  // the default gap: the part's height, a generated model's height, the top of its model file's box, else 8 mm
  const model = fp!.model as { height?: unknown } | undefined
  const box = heights.find(h => h.ref === fp!.ref)
  const [height, from]: [number, 'height' | 'model' | 'default'] =
    fp!.height !== undefined ? [fp!.height, 'height'] : typeof model?.height === 'number' ? [model.height, 'model'] : box?.from === 'model' ? [box.height, 'model'] : [8, 'default']
  return { fp: fp!, pad: pad!, pads, height, from }
}
