// Fits KiCad's model transform so the model's pins, read from a height map seen from below, land on the footprint's pads.
import { bounds, type StepModel } from './mesh.js'
import { apply, heightAgrees, modelMatrix, mul, rotX, rotY, rotZ, type Mat4, type Rect, type StepTransform, type Vec3 } from './place.js'

/** A pad in the footprint frame: centre and size in mm, x right and y down; `drill` for a through-hole pad. */
export interface AlignPad {
  x: number
  y: number
  w: number
  h: number
  drill?: number
}

/** The footprint's pads, its courtyard and its declared body height, which tells a standing model from one lying down. */
export interface AlignTarget {
  pads: AlignPad[]
  courtyard?: Rect
  height?: number
}

/** Transforms kept when they already fit, such as the part's current one; the file's own frame is always tried. */
export interface AlignOptions {
  keep?: StepTransform[]
}

/** The unit a file seems to be drawn in: the factor to millimetres and its name. */
export interface UnitGuess {
  scale: number
  name: string
}

export interface AlignResult {
  /** KiCad's model transform to use, offset in mm and rotate in degrees */
  transform: StepTransform
  /** 0 to 1: the share of pins on pads times the share of pads with a pin, lower when another orientation fits as well */
  confidence: number
  unit: UnitGuess
  /** the model axis that ends up pointing up, such as +z, and the turn about z in degrees */
  up: string
  turn: number
  /** pins found, pins on a pad, pads the pins were matched against */
  pins: number
  matched: number
  pads: number
  /** the mean distance in mm from a matched pin to its pad centre */
  error: number
  /** a remark for the user, such as another orientation fitting equally well */
  note?: string
  /** set when a transform to keep already fitted: 'current' for the part's own, 'file' for the file's own frame */
  kept?: 'current' | 'file'
}

const UNITS: UnitGuess[] = [
  { scale: 1, name: 'mm' },
  { scale: 25.4, name: 'inches' },
  { scale: 1000, name: 'metres' },
  { scale: 2.54, name: 'tenths of an inch' },
  { scale: 10, name: 'centimetres' },
  { scale: 0.001, name: 'micrometres' },
  { scale: 0.0254, name: 'mils' },
  { scale: 1 / 25.4, name: 'mm read as inches' },
]

/** A model's unit from its largest extent against the footprint's size: mm within a factor of three, else the closest unit. */
export function guessUnit(extent: number, target?: number): UnitGuess {
  if (!(extent > 0)) return UNITS[0]
  if (!target || !(target > 0)) return extent < 0.2 ? UNITS[2] : extent > 300 ? UNITS[5] : UNITS[0]
  const ratio = extent / target
  if (ratio >= 0.33 && ratio <= 3) return UNITS[0]
  return UNITS.reduce((a, u) => (Math.abs(Math.log((u.scale * ratio) / 1.1)) < Math.abs(Math.log((a.scale * ratio) / 1.1)) ? u : a))
}

const DEG = Math.PI / 180
const UPS: { name: string; m: Mat4 }[] = [
  { name: '+z', m: rotX(0) },
  { name: '-z', m: rotX(Math.PI) },
  { name: '+y', m: rotX(Math.PI / 2) },
  { name: '-y', m: rotX(-Math.PI / 2) },
  { name: '+x', m: rotY(-Math.PI / 2) },
  { name: '-x', m: rotY(Math.PI / 2) },
]

interface View {
  pins: { x: number; y: number; n: number }[]
  seat: number
  lowest: number
  top: number
  box: { x0: number; y0: number; x1: number; y1: number }
}

/** The model seen from below after `m`: its seat, its XY box and the pin islands, each as a centre and a cell count. */
function viewFromBelow(model: StepModel, m: Mat4, tht: boolean): View | null {
  const tris: number[] = []
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
  let zlo = Infinity,
    zhi = -Infinity
  const meshes = model.meshes.map(me => {
    const p = new Float64Array(me.positions.length)
    for (let i = 0; i < p.length; i += 3) {
      const q = apply(m, [me.positions[i], me.positions[i + 1], me.positions[i + 2]])
      p[i] = q[0]
      p[i + 1] = q[1]
      p[i + 2] = q[2]
      box.x0 = Math.min(box.x0, q[0])
      box.x1 = Math.max(box.x1, q[0])
      box.y0 = Math.min(box.y0, q[1])
      box.y1 = Math.max(box.y1, q[1])
      zlo = Math.min(zlo, q[2])
      zhi = Math.max(zhi, q[2])
    }
    return { p, ix: me.indices }
  })
  if (!Number.isFinite(zlo)) return null
  const size = Math.max(box.x1 - box.x0, box.y1 - box.y0, 1e-3)
  const cell = Math.min(0.2, Math.max(0.03, size / 250))
  const nx = Math.ceil((box.x1 - box.x0) / cell) + 1,
    ny = Math.ceil((box.y1 - box.y0) / cell) + 1
  const z = new Float32Array(nx * ny).fill(Infinity)
  for (const { p, ix } of meshes)
    for (let t = 0; t < ix.length; t += 3) {
      const a = ix[t] * 3,
        b = ix[t + 1] * 3,
        c = ix[t + 2] * 3
      const ax = p[a],
        ay = p[a + 1],
        bx = p[b],
        by = p[b + 1],
        cx = p[c],
        cy = p[c + 1]
      const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
      if (Math.abs(d) < 1e-12) continue
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - box.x0) / cell)),
        i1 = Math.min(nx - 1, Math.ceil((Math.max(ax, bx, cx) - box.x0) / cell))
      const j0 = Math.max(0, Math.floor((Math.min(ay, by, cy) - box.y0) / cell)),
        j1 = Math.min(ny - 1, Math.ceil((Math.max(ay, by, cy) - box.y0) / cell))
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const x = box.x0 + (i + 0.5) * cell,
            y = box.y0 + (j + 0.5) * cell
          const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d,
            l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d,
            l3 = 1 - l1 - l2
          if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue
          const zz = l1 * p[a + 2] + l2 * p[b + 2] + l3 * p[c + 2]
          if (zz < z[j * nx + i]) z[j * nx + i] = zz
        }
    }
  const covered = [...z].filter(Number.isFinite).sort((p, q) => p - q)
  if (!covered.length) return null
  const lowest = covered[0],
    height = zhi - zlo
  // THT pins hang over 0.3 mm below the lowest tenth of the underside and the part sits on the rest; SMD sits on its pins
  const limit = tht ? covered[Math.floor(covered.length * 0.1)] - 0.3 : lowest + Math.max(0.03, 0.02 * height)
  const seat = tht ? (covered.find(v => v >= limit) ?? lowest) : lowest
  const isPin = (k: number) => z[k] < limit
  const seen = new Uint8Array(nx * ny)
  const pins: View['pins'] = []
  for (let k = 0; k < z.length; k++) {
    if (seen[k] || !isPin(k)) continue
    let sx = 0,
      sy = 0,
      n = 0
    const stack = [k]
    seen[k] = 1
    while (stack.length) {
      const q = stack.pop()!,
        i = q % nx,
        j = (q - i) / nx
      sx += i
      sy += j
      n++
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          const ii = i + di,
            jj = j + dj
          if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue
          const r = jj * nx + ii
          if (!seen[r] && isPin(r)) {
            seen[r] = 1
            stack.push(r)
          }
        }
    }
    if (n >= 2) pins.push({ x: box.x0 + (sx / n + 0.5) * cell, y: box.y0 + (sy / n + 0.5) * cell, n })
  }
  // one island over most of the underside is a flat bottom, not pins
  const area = covered.length
  return { pins: pins.filter(p => p.n < area * 0.5), seat, lowest, top: zhi, box }
}

interface Fit {
  score: number
  soft: number
  t: [number, number]
  matched: number
  error: number
}

/** How close the two point sets come, 0 to 1, with a millimetre of grace: for a footprint drawn near but not on the real part. */
function softFit(pins: View['pins'], pads: { x: number; y: number }[], t: [number, number]): number {
  const near = (x: number, y: number, set: { x: number; y: number }[], dx: number, dy: number) =>
    Math.exp(-Math.min(...set.map(q => (q.x + dx - x) ** 2 + (q.y + dy - y) ** 2)) / 2)
  const a = pads.reduce((s, q) => s + near(q.x, q.y, pins, t[0], t[1]), 0) / pads.length
  const b = pins.reduce((s, p) => s + near(p.x + t[0], p.y + t[1], pads, 0, 0), 0) / pins.length
  return (a + b) / 2
}

/** How well pins moved by t land on the pads: the share of pins on a pad times the share of pads with a pin. */
function fitAt(pins: View['pins'], pads: { x: number; y: number; tol: number }[], t: [number, number]): Fit {
  let matched = 0,
    err = 0
  const hit = new Uint8Array(pads.length)
  for (const p of pins) {
    const x = p.x + t[0],
      y = p.y + t[1]
    let best = -1,
      bd = Infinity
    pads.forEach((q, k) => {
      const d = Math.hypot(q.x - x, q.y - y)
      if (d < bd) {
        bd = d
        best = k
      }
    })
    if (best >= 0 && bd <= pads[best].tol) {
      matched++
      err += bd
      hit[best] = 1
    }
  }
  const padsHit = hit.reduce((a, v) => a + v, 0)
  const score = pins.length && pads.length ? (matched / pins.length) * (padsHit / pads.length) : 0
  return { score, soft: pins.length && pads.length ? softFit(pins, pads, t) : 0, t, matched, error: matched ? err / matched : 0 }
}

/** Move t so matched pins sit on their pads on average, weighted by area so a sliver of a contact counts little. */
function refine(pins: View['pins'], pads: { x: number; y: number; tol: number }[], t: [number, number]): [number, number] {
  for (let round = 0; round < 4; round++) {
    let dx = 0,
      dy = 0,
      n = 0
    for (const p of pins) {
      const x = p.x + t[0],
        y = p.y + t[1]
      let best = -1,
        bd = Infinity
      pads.forEach((q, k) => {
        const d = Math.hypot(q.x - x, q.y - y)
        if (d < bd) {
          bd = d
          best = k
        }
      })
      if (best >= 0 && bd <= pads[best].tol) {
        dx += (pads[best].x - x) * p.n
        dy += (pads[best].y - y) * p.n
        n += p.n
      }
    }
    if (!n) break
    t = [t[0] + dx / n, t[1] + dy / n]
  }
  return t
}

/** KiCad rotate angles, each a multiple of 90, whose model matrix is m; the one with the fewest turns. */
function kicadAngles(m: Mat4): Vec3 {
  const A = [0, 90, 180, -90]
  let best: Vec3 = [0, 0, 0],
    bestN = 4
  for (const rx of A)
    for (const ry of A)
      for (const rz of A) {
        const k = modelMatrix({ offset: [0, 0, 0], rotate: [rx, ry, rz], scale: [1, 1, 1] })
        if (k.some((v, i) => Math.abs(v - m[i]) > 1e-6)) continue
        const n = [rx, ry, rz].filter(Boolean).length
        if (n < bestN) {
          best = [rx, ry, rz]
          bestN = n
        }
      }
  return best
}

const round2 = (v: number) => {
  const r = Math.round(v * 100) / 100
  return Math.abs(r) < 0.015 ? 0 : r
}

type MPad = { x: number; y: number; w: number; h: number; tol: number }

/** The smallest spacing of the pad centres along one axis, 0 when they all share it. */
function pitchOf(pads: MPad[], k: 'x' | 'y'): number {
  const v = [...new Set(pads.map(p => Math.round(p[k] * 1000) / 1000))].sort((a, b) => a - b)
  let best = 0
  for (let i = 1; i < v.length; i++) {
    const d = v[i] - v[i - 1]
    if (d > 0.05 && (!best || d < best)) best = d
  }
  return best
}

/** An offset snapped to 0, else to a multiple of the pad pitch or of half of it, when one is within 0.1 mm. */
function snap(v: number, pitch: number): number {
  if (Math.abs(v) <= 0.1) return 0
  for (const step of pitch ? [pitch, pitch / 2] : []) {
    const k = Math.round(v / step) * step
    if (Math.abs(k - v) <= 0.1) return k
  }
  return v
}

/** Whether every pin that lands on a pad at t sits on that pad's copper, with 0.1 mm to spare. */
function onCopper(pins: View['pins'], pads: MPad[], t: [number, number]): boolean {
  for (const p of pins) {
    const x = p.x + t[0],
      y = p.y + t[1]
    let best = -1,
      bd = Infinity
    pads.forEach((q, k) => {
      const d = Math.hypot(q.x - x, q.y - y)
      if (d < bd) {
        bd = d
        best = k
      }
    })
    if (best < 0 || bd > pads[best].tol) continue
    const q = pads[best]
    if (Math.abs(q.x - x) > q.w / 2 + 0.1 || Math.abs(q.y - y) > q.h / 2 + 0.1) return false
  }
  return true
}

/** Fit a model to a footprint: by its pins on the pads, else by its box in the courtyard. */
export function alignModel(model: StepModel, target: AlignTarget, opts: AlignOptions = {}): AlignResult {
  const b = bounds(model)
  const extent = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2])
  const pb = target.pads.reduce(
    (a, p) => ({ x0: Math.min(a.x0, p.x - p.w / 2), y0: Math.min(a.y0, p.y - p.h / 2), x1: Math.max(a.x1, p.x + p.w / 2), y1: Math.max(a.y1, p.y + p.h / 2) }),
    { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity },
  )
  const footBox = target.courtyard ?? (target.pads.length ? pb : undefined)
  const unit = guessUnit(extent, footBox ? Math.max(footBox.x1 - footBox.x0, footBox.y1 - footBox.y0) : undefined)
  const s = unit.scale
  const tht = target.pads.some(p => p.drill)
  // pads in the model frame, y up; a through-hole part is matched on its drilled pads only
  const pads: MPad[] = target.pads.filter(p => !tht || p.drill).map(p => ({ x: p.x, y: -p.y, w: p.w, h: p.h, tol: Math.max(0.35, 0.5 * Math.max(p.w, p.h)) }))
  const padBox = pads.length ? { x: (pb.x0 + pb.x1) / 2, y: -(pb.y0 + pb.y1) / 2 } : { x: 0, y: 0 }
  const court = footBox ? { x0: footBox.x0, x1: footBox.x1, y0: -footBox.y1, y1: -footBox.y0 } : undefined
  const height = target.height !== undefined && target.height > 0 ? target.height : undefined
  const key = (f: Fit) => f.score + 0.25 * f.soft
  const scoreOf = (pins: View['pins'], fit: Fit, box: View['box'], t: [number, number]) => {
    // pins near pads, in about the right number, count for a footprint drawn from a guess
    const count = pins.length && pads.length ? Math.min(pins.length, pads.length) / Math.max(pins.length, pads.length) : 0
    let score = 0.75 * fit.score + 0.25 * fit.soft * count
    if (court) {
      const over = Math.max(0, court.x0 - (box.x0 + t[0]), box.x1 + t[0] - court.x1, court.y0 - (box.y0 + t[1]), box.y1 + t[1] - court.y1)
      const fill = Math.exp(
        -(Math.abs(Math.log((box.x1 - box.x0 + 1e-3) / (court.x1 - court.x0 + 1e-3))) + Math.abs(Math.log((box.y1 - box.y0 + 1e-3) / (court.y1 - court.y0 + 1e-3)))),
      )
      // pins decide when there are any; the courtyard breaks ties and decides alone without pins
      score = score > 0 ? score * (0.8 + 0.2 / (1 + Math.max(0, over - 1))) + 0.05 * fill : (0.2 * fill) / (1 + over)
    } else if (score === 0) score = 0.1
    return score
  }
  interface Cand {
    score: number
    up: string
    turn: number
    m: Mat4
    t: [number, number]
    view: View
    fit: Fit
    pins: number
    box: View['box']
  }
  const cands: Cand[] = []
  for (const [ui, up] of UPS.entries()) {
    const base = mul(up.m, [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1])
    const view = viewFromBelow(model, base, tht)
    if (!view) continue
    for (const turn of [0, 90, 180, 270]) {
      const r = rotZ(turn * DEG)
      const pins = view.pins.map(p => {
        const q = apply(r, [p.x, p.y, 0])
        return { x: q[0], y: q[1], n: p.n }
      })
      const corners = [
        [view.box.x0, view.box.y0],
        [view.box.x1, view.box.y1],
      ].map(([x, y]) => apply(r, [x, y, 0]))
      const box = {
        x0: Math.min(corners[0][0], corners[1][0]),
        x1: Math.max(corners[0][0], corners[1][0]),
        y0: Math.min(corners[0][1], corners[1][1]),
        y1: Math.max(corners[0][1], corners[1][1]),
      }
      const centre: [number, number] = [padBox.x - (box.x0 + box.x1) / 2, padBox.y - (box.y0 + box.y1) / 2]
      let fit: Fit = { score: 0, soft: 0, t: centre, matched: 0, error: 0 }
      if (pins.length && pads.length) {
        const starts: [number, number][] = [centre]
        const pinBox = pins.reduce((a, p) => ({ x0: Math.min(a.x0, p.x), x1: Math.max(a.x1, p.x), y0: Math.min(a.y0, p.y), y1: Math.max(a.y1, p.y) }), {
          x0: Infinity,
          y0: Infinity,
          x1: -Infinity,
          y1: -Infinity,
        })
        const padPts = pads.reduce((a, p) => ({ x0: Math.min(a.x0, p.x), x1: Math.max(a.x1, p.x), y0: Math.min(a.y0, p.y), y1: Math.max(a.y1, p.y) }), {
          x0: Infinity,
          y0: Infinity,
          x1: -Infinity,
          y1: -Infinity,
        })
        starts.push([(padPts.x0 + padPts.x1 - pinBox.x0 - pinBox.x1) / 2, (padPts.y0 + padPts.y1 - pinBox.y0 - pinBox.y1) / 2])
        for (const p of pins.slice(0, 3)) for (const q of pads) starts.push([q.x - p.x, q.y - p.y])
        for (const st of starts) {
          const f = fitAt(pins, pads, st)
          if (key(f) > key(fit) + 1e-9) fit = f
        }
        if (fit.score > 0) fit = fitAt(pins, pads, refine(pins, pads, fit.t))
      }
      let score = scoreOf(pins, fit, box, fit.score > 0 || fit.soft > 0 ? fit.t : centre)
      const t = score > 0 && (fit.score > 0 || fit.soft > 0) ? fit.t : centre
      // the file's own orientation first when two fit alike
      score -= (ui * 4 + turn / 90) * 1e-6
      cands.push({
        score,
        up: up.name,
        turn,
        m: mul(r, up.m),
        t,
        view,
        fit,
        pins: pins.length,
        box: { x0: box.x0 + t[0], x1: box.x1 + t[0], y0: box.y0 + t[1], y1: box.y1 + t[1] },
      })
    }
  }
  if (!cands.length) throw new Error('the model has no geometry to align')
  cands.sort((p, q) => q.score - p.score)
  // the file as drawn wins unless most pins land on pads well ahead of any upright fit; without pins the height decides
  const tall = (c: Cand) => c.view.top - c.view.seat
  const upright = cands.filter(c => c.up === '+z')
  const clear = (c: Cand) => c.fit.score >= 0.5 && c.fit.score >= (upright[0]?.fit.score ?? 0) + 0.3
  let best = cands[0]
  if (best.up !== '+z' && upright.length && !clear(best)) {
    best = upright[0]
    if (height !== undefined && !heightAgrees(tall(best), height)) best = cands.find(c => heightAgrees(tall(c), height) && c.score >= upright[0].score * 0.8) ?? best
  }
  // offsets within 0.1 mm of 0, or of the pad pitch, are that
  const px = pitchOf(pads, 'x'),
    py = pitchOf(pads, 'y')
  let t: [number, number] = [snap(best.t[0], px), snap(best.t[1], py)]
  // keep the file's z = 0 when it is on the board, or when THT pins pass through it under a standoff body such as a TO-220
  let z = -best.view.seat
  if (best.up === '+z' && s === 1 && (Math.abs(best.view.seat) <= 0.1 || (tht && best.view.lowest < -0.3 && best.view.seat >= -0.1))) z = 0
  // another orientation that fits as well but puts the body elsewhere is worth a look
  const rival = cands.find(
    c =>
      c !== best &&
      c.up === best.up &&
      c.score >= best.score * 0.97 &&
      Math.max(Math.abs(c.box.x0 - best.box.x0), Math.abs(c.box.x1 - best.box.x1), Math.abs(c.box.y0 - best.box.y0), Math.abs(c.box.y1 - best.box.y1)) > 0.5,
  )
  let confidence = Math.max(0, Math.min(1, best.score))
  if (rival) confidence *= 0.6
  const found: AlignResult = {
    transform: { offset: [round2(t[0]), round2(t[1]), round2(z)], rotate: kicadAngles(best.m), scale: [s, s, s] },
    confidence: Math.round(confidence * 100) / 100,
    unit,
    up: best.up,
    turn: best.turn,
    pins: best.pins,
    matched: best.fit.matched,
    pads: pads.length,
    error:
      Math.round(
        fitAt(
          best.view.pins.map(p => {
            const q = apply(rotZ(best.turn * DEG), [p.x, p.y, 0])
            return { x: q[0], y: q[1], n: p.n }
          }),
          pads,
          t,
        ).error * 100,
      ) / 100,
    ...(rival ? { note: `turned ${(rival.turn - best.turn + 360) % 360} degrees about z fits as well: check pin 1 in the shot` } : {}),
  }
  // a kept transform stays when it fits as well as the search: as many pins on pad copper, or without pins its box on the pads
  const ident: StepTransform = { offset: [0, 0, 0], rotate: [0, 0, 0], scale: [1, 1, 1] }
  const keeps: [StepTransform, 'current' | 'file'][] = [...(opts.keep ?? []).map(k => [k, 'current'] as [StepTransform, 'current']), [ident, 'file']]
  for (const [k, kind] of keeps) {
    const view = viewFromBelow(model, modelMatrix(k), tht)
    if (!view) continue
    const seated = Math.abs(view.seat) <= 0.1 || (tht && view.lowest < -0.3 && view.seat >= -0.1)
    if (!seated || (height !== undefined && !heightAgrees(view.top - Math.max(0, view.seat), height) && heightAgrees(tall(best), height))) continue
    let fit: Fit = { score: 0, soft: 0, t: [0, 0], matched: 0, error: 0 }
    if (best.fit.matched > 0) {
      if (!view.pins.length) continue
      fit = fitAt(view.pins, pads, [0, 0])
      if (fit.matched < Math.ceil(0.85 * best.fit.matched) || fit.score < 0.85 * best.fit.score || !onCopper(view.pins, pads, [0, 0])) continue
    } else {
      const c = { x: (view.box.x0 + view.box.x1) / 2, y: (view.box.y0 + view.box.y1) / 2 }
      if (pads.length && (Math.abs(c.x - padBox.x) > 0.5 || Math.abs(c.y - padBox.y) > 0.5)) continue
    }
    const score = Math.max(0, Math.min(1, scoreOf(view.pins, fit, view.box, [0, 0])))
    return {
      transform: { offset: [...k.offset] as Vec3, rotate: [...k.rotate] as Vec3, scale: [...k.scale] as Vec3 },
      confidence: Math.round(score * (rival ? 0.6 : 1) * 100) / 100,
      unit: kind === 'file' ? UNITS[0] : unit,
      up: '+z',
      turn: 0,
      pins: view.pins.length,
      matched: fit.matched,
      pads: pads.length,
      error: Math.round(fit.error * 100) / 100,
      kept: kind,
      ...(rival ? { note: found.note } : {}),
    }
  }
  return found
}
