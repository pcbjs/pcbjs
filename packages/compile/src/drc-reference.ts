// DRC of board references, see references.md: reference-mate, reference-net and reference-collision.
import type { Board, DrcMarker, Footprint, Pad, Pt, Ring } from '@pcbjs/core/model'
import type { BoardReference, MatePair } from '@pcbjs/core/reference'
import { area, centroid, clipRings, offsetRings } from './geom.js'
import { bareHole } from './bare.js'

/** How far a mating pad may land from a local pad, and how deep two solids may meet, mm. */
export const MATE_TOLERANCE = 0.1
export const COLLISION_DEPTH = 0.1

const f2 = (v: number) => (Math.round(v * 100) / 100).toFixed(2)
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1])

export function referenceDrc(board: Board): DrcMarker[] {
  const out: DrcMarker[] = []
  const refs = board.references ?? []
  if (!refs.length) return out
  const mine = localSolids(board, refs[0].heights)
  for (const r of refs) {
    for (const pair of pairsOf(r)) {
      const m = mateFinding(r, pair)
      if (m) out.push(m)
      out.push(...netFindings(r, pair, !m))
    }
    out.push(...collisions(board, r, mine))
  }
  // every pair of references too, as two strips that butt on a splice board
  const names = labels(refs)
  for (let i = 0; i < refs.length; i++)
    for (let j = i + 1; j < refs.length; j++) out.push(...meet(theirSolids(refs[j], names[j]), theirSolids(refs[i], names[i]), [], b => `${b.what}${b.ref ? ' body' : ''}`))
  return out
}

/** The name of each reference in findings: its board's name, numbered when two references bring the same name. */
function labels(refs: BoardReference[]): string[] {
  const count = new Map<string, number>(),
    seen = new Map<string, number>()
  for (const r of refs) count.set(r.name, (count.get(r.name) ?? 0) + 1)
  return refs.map(r => {
    if (count.get(r.name)! < 2) return r.name
    const k = (seen.get(r.name) ?? 0) + 1
    seen.set(r.name, k)
    return `${r.name} #${k}`
  })
}

/** Every mating pair of a reference: the one of `mate`, or all of `mates`. */
const pairsOf = (r: BoardReference): MatePair[] => r.mates ?? (r.mate ? [r.mate] : [])

/** The pins of the remote connector that land on no local pad of the mating part, as one error naming the first. */
function mateFinding(r: BoardReference, pair: MatePair): DrcMarker | null {
  const { local, remote } = pair
  const nearest = (p: Pt, pads: { at: Pt }[]) => pads.reduce((d, q) => Math.min(d, dist(p, q.at)), Infinity)
  const miss = remote.pads.map(q => ({ q, d: nearest(q.at, local.pads) })).filter(x => x.d > MATE_TOLERANCE)
  if (!miss.length) return null
  // a connector turned the other way round is the usual mistake: say so when half a turn lands every pin
  const pin = local.pads.find(q => q.num === local.pin)?.at
  const turned = pin && remote.pads.every(q => nearest([2 * pin[0] - q.at[0], 2 * pin[1] - q.at[1]], local.pads) <= MATE_TOLERANCE)
  const first = miss[0]
  return {
    severity: 'error',
    rule: 'reference-mate',
    message: `${r.name} ${remote.ref} pin ${first.q.num} lands ${f2(first.d)} mm from the nearest pad of ${local.ref}${miss.length > 1 ? `, ${miss.length} of ${remote.pads.length} pins miss` : ''}${turned ? `; rotate: ${(r.rotate + 180) % 360 || 0} lands every pin` : ''}`,
    at: first.q.at,
  }
}

/** `reference-net`: each local pad's net against the name the mate's `nets` maps it to on the remote pad landing there. */
function netFindings(r: BoardReference, m: MatePair, landed: boolean): DrcMarker[] {
  if (!m.nets) return []
  const out: DrcMarker[] = []
  const named = (n?: string) => (n ? `net ${n}` : 'no net')
  for (const p of m.local.pads) {
    if (!p.net || p.want === undefined) continue
    let q: (typeof m.remote.pads)[number] | undefined,
      best = Infinity
    for (const c of m.remote.pads) {
      const d = dist(p.at, c.at)
      if (d < best) {
        best = d
        q = c
      }
    }
    if (!q || best > MATE_TOLERANCE) {
      if (landed) out.push({ severity: 'error', rule: 'reference-net', message: `${m.local.ref} pin ${p.num} ${named(p.net)} meets no pin of ${r.name} ${m.remote.ref}`, at: p.at })
      continue
    }
    // a remote pin with no net is a no-connect there
    if (!q.net) continue
    const wants = Array.isArray(p.want) ? p.want : [p.want]
    if (wants.includes(q.net ?? '')) continue
    const mapped = wants.length > 1 || wants[0] !== p.net ? `; the mate maps ${p.net} to ${wants.join(' or ')}` : ''
    out.push({
      severity: 'error',
      rule: 'reference-net',
      message: `${m.local.ref} pin ${p.num} ${named(p.net)} meets ${r.name} ${m.remote.ref} pin ${q.num} ${named(q.net)}${mapped}`,
      at: p.at,
    })
  }
  return out
}

interface Solid {
  what: string
  ring: Ring
  z: [number, number]
  ref?: string
  items?: number[]
}

/** This board's slab and its part bodies as boxes, front above and back below, as tall as the references resolved them. */
function localSolids(board: Board, heights: BoardReference['heights']): Solid[] {
  const out: Solid[] = []
  const outer = largest(board.outline)
  if (outer) out.push({ what: 'this board', ring: outer, z: [0, board.thickness] })
  const known = new Map((heights ?? []).map(h => [h.ref, h.height]))
  for (const fp of board.footprints) {
    const h = known.get(fp.ref) ?? fp.height ?? (bareHole(board, fp) ? 0 : 1)
    if (!(h > 0)) continue
    const pads = fp.pads.map(id => board.items[id - 1]).filter((it): it is Pad => it?.kind === 'pad')
    out.push({ what: fp.ref, ref: fp.ref, ring: bodyRing(board, fp), z: fp.side === 'F' ? [board.thickness, board.thickness + h] : [-h, 0], items: pads.map(p => p.id) })
  }
  return out
}

/** A reference's slab and part bodies, named by `name`. */
function theirSolids(r: BoardReference, name = r.name): Solid[] {
  const out: Solid[] = []
  const slab = largest(r.outline)
  if (slab) out.push({ what: `${name}'s board`, ring: slab, z: r.z })
  for (const b of r.bodies) out.push({ what: `${name} ${b.ref}`, ref: b.ref, ring: b.ring, z: b.z })
  return out
}

function collisions(board: Board, r: BoardReference, mine: Solid[]): DrcMarker[] {
  const into = (b: Solid) => (b.ref ? `${b.ref}${board.footprints.find(f => f.ref === b.ref)?.side === 'B' ? ' on the back' : ''}` : "this board's slab")
  return meet(theirSolids(r), mine, pairsOf(r), into)
}

/** `reference-collision`: each solid of `theirs` reaching more than COLLISION_DEPTH into one of `mine`, the mating pairs left out. */
function meet(theirs: Solid[], mine: Solid[], pairs: MatePair[], into: (b: Solid) => string): DrcMarker[] {
  const out: DrcMarker[] = []
  for (const a of theirs)
    for (const b of mine) {
      // the mating pairs meet by design
      if (pairs.some(q => a.ref === q.remote.ref && b.ref === q.local.ref)) continue
      // a coplanar reference's slab meets this one at their edges at most
      const depth = Math.min(a.z[1], b.z[1]) - Math.max(a.z[0], b.z[0])
      if (depth <= COLLISION_DEPTH || !boxesMeet(a.ring, b.ring)) continue
      const inside = clipRings('intersection', offsetRings([a.ring], -COLLISION_DEPTH / 2), offsetRings([b.ring], -COLLISION_DEPTH / 2))
      if (!inside.length || Math.abs(area(inside)) < 1e-6) continue
      out.push({
        severity: 'warning',
        rule: 'reference-collision',
        message: `${a.what} ${a.ref ? 'body ' : ''}reaches ${f2(depth)} mm into ${into(b)}`,
        at: centroid(inside),
        ...(b.items?.length ? { items: b.items } : {}),
      })
    }
  return out
}

const largest = (rings: Ring[]): Ring | undefined => rings.reduce<Ring | undefined>((m, q) => (!m || Math.abs(area([q])) > Math.abs(area([m])) ? q : m), undefined)

function boxesMeet(a: Ring, b: Ring): boolean {
  const box = (r: Ring) => {
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity
    for (const [x, y] of r) {
      x0 = Math.min(x0, x)
      x1 = Math.max(x1, x)
      y0 = Math.min(y0, y)
      y1 = Math.max(y1, y)
    }
    return [x0, y0, x1, y1]
  }
  const p = box(a),
    q = box(b)
  return p[0] < q[2] && q[0] < p[2] && p[1] < q[3] && q[1] < p[3]
}

/** The body box of a footprint in board mm: the extent of its Fab graphics in its own frame, else of its pads, as the 3D view draws it. */
function bodyRing(board: Board, fp: Footprint): Ring {
  const a = (fp.rot * Math.PI) / 180,
    u: Pt = [Math.cos(a), -Math.sin(a)],
    v: Pt = [Math.sin(a), Math.cos(a)]
  const fab = fp.side === 'F' ? 'F.Fab' : 'B.Fab'
  let pts: Pt[] = []
  for (const it of board.items) if (it.kind === 'graphic' && it.ref === fp.ref && it.layer === fab) for (const r of it.paths) pts.push(...r)
  if (!pts.length)
    for (const id of fp.pads) {
      const it = board.items[id - 1]
      if (it?.kind === 'pad') pts.push(...it.poly)
    }
  if (!pts.length) pts = [fp.at]
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity
  for (const [px, py] of pts) {
    const dx = px - fp.at[0],
      dy = py - fp.at[1],
      lx = dx * u[0] + dy * u[1],
      ly = dx * v[0] + dy * v[1]
    x0 = Math.min(x0, lx)
    x1 = Math.max(x1, lx)
    y0 = Math.min(y0, ly)
    y1 = Math.max(y1, ly)
  }
  const at = (lx: number, ly: number): Pt => [fp.at[0] + lx * u[0] + ly * v[0], fp.at[1] + lx * u[1] + ly * v[1]]
  return [at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1)]
}
