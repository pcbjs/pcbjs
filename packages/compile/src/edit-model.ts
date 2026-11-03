// What the viewer's tools may change: each placed part, named group, instance and text with the frame of its `at`, each route with its chain calls; see docs/editing.md.
import type { Board, Capability, EditNode } from '@pcbjs/core/model'
import type { Flat } from './flatten.js'
import { apply, IDENTITY, invert, isMirrored, mul, placement, rotationOf, type Mat } from './geom.js'
import type { Src } from '@pcbjs/core/internal/types'
import { methodOf } from '@pcbjs/core/internal/syntax'

const round = (v: number) => Math.round(v * 1e6) / 1e6 || 0
const SLOTS = ['x', 'y', 'rot'] as const

const siteKey = (s: Src | undefined) => (s ? `${s.file}:${s.line}:${s.col}` : '')

/** The edit nodes of a placed board, parts, named groups, instances and texts in tree order, then routes by id. */
export function editNodes(board: Board, flat: Pick<Flat, 'placements' | 'placeJobs' | 'autoRoutes' | 'routeScopes'>): EditNode[] {
  const out: EditNode[] = []
  const chain = frameChain(flat.placements)
  const texts = new Map<string, number>()
  for (const p of flat.placements) if (p.text) texts.set(siteKey(p.src), (texts.get(siteKey(p.src)) ?? 0) + 1)
  // the text as the board holds it now, with its uid
  const uids = new Map(board.items.map(it => [it.id, it.uid]))
  for (const p of flat.placements) {
    const base = {
      m: p.m.map(round) as EditNode['m'],
      grid: p.grid,
      ...(p.snap !== undefined ? { snap: p.snap } : {}),
      src: p.src ? { at: p.src } : {},
      ...(p.layout ? { layout: p.layout } : {}),
      ...(p.def ? { def: p.def } : {}),
      ...chain(p.within),
      ...(p.owned ? { owned: p.owned } : {}),
    }
    if (p.fp) {
      const job = flat.placeJobs.find(j => j.fp === p.fp)
      const auto = job ? SLOTS.filter((_, i) => job.fixed[i] === null) : []
      const fp = p.fp
      out.push({ ref: fp.ref, caps: ['placed', 'layered'], ...base, ...(auto.length ? { auto } : {}), at: [round(fp.at[0]), round(fp.at[1]), round(fp.rot)], side: fp.side })
    } else if (p.group && p.at) {
      const m = mul(p.m, placement(p.at[0], p.at[1], p.at[2], p.side === 'B'))
      const o = apply(m, [0, 0])
      const grid = board.grids?.find(g => g.name === p.rotationGrid)
      out.push({ ref: p.group, caps: ['placed', 'layered'], ...base, ...(grid ? { pivot: grid.origin } : {}), at: [round(o[0]), round(o[1]), round(rotationOf(m))], side: p.side ?? 'F' })
    } else if (p.inst && p.computed) out.push({ ref: p.inst, caps: [], ...base, computed: true })
    else if (p.inst && p.at) {
      const m = mul(p.m, placement(p.at[0], p.at[1], p.at[2], p.side === 'B'))
      const o = apply(m, [0, 0])
      const grid = board.grids?.find(g => g.name === p.rotationGrid)
      out.push({ ref: p.inst, caps: ['placed', 'layered'], ...base, ...(grid ? { pivot: grid.origin } : {}), at: [round(o[0]), round(o[1]), round(rotationOf(m))], side: isMirrored(m) ? 'B' : 'F' })
    } else if (p.text && uids.get(p.text.id) && p.at && p.src && texts.get(siteKey(p.src)) === 1) {
      // an element a layout renders for several instances draws one text each, and none of them has an element of its own
      const m = mul(p.m, placement(p.at[0], p.at[1], p.at[2], false))
      const o = apply(m, [0, 0])
      out.push({ ref: uids.get(p.text.id)!, caps: ['placed'], ...base, at: [round(o[0]), round(o[1]), round(rotationOf(m))] })
    }
  }
  const seen = new Set<string>()
  for (const job of flat.autoRoutes) {
    if (!job.route || job.sub || seen.has(job.route)) continue
    seen.add(job.route)
    let layer = job.layer ?? 'F.Cu'
    const steps = (job.steps ?? []).map(st => {
      if (st.op === 'U') layer = st.layer
      return { op: methodOf(st), layer, ...(st.op === 'A' ? { angle: st.angle } : {}), ...(st.src ? { src: st.src } : {}) }
    })
    const caps: Capability[] = steps.some(s => s.op === 'via') ? ['chain', 'viaEnd'] : ['chain']
    const sc = flat.routeScopes[job.route]
    out.push({
      ref: job.route,
      caps,
      src: job.src ? { chain: job.src } : {},
      m: (job.m ?? IDENTITY).map(round) as EditNode['m'],
      grid: null,
      steps,
      ...(sc?.def ? { def: sc.def } : {}),
      ...chain(sc?.within ?? []),
    })
  }
  return out
}

/** The frames of the instances and groups placements name, each in the one before; an instance whose render takes no `at` draws in the frame of its element. */
function frameChain(placements: Flat['placements']): (within: string[]) => Pick<EditNode, 'frames'> {
  const board = new Map<string, Mat>()
  for (const p of placements) {
    const own = p.inst ?? p.group
    if (own && p.at) board.set(own, mul(p.m, placement(p.at[0], p.at[1], p.at[2], p.side === 'B')))
    else if (own && p.computed) board.set(own, p.m)
  }
  return within => {
    const frames: NonNullable<EditNode['frames']> = []
    let outer: Mat = IDENTITY
    for (const inst of within) {
      const f = board.get(inst)
      if (!f) continue
      frames.push({ inst, m: mul(invert(outer), f).map(round) as EditNode['m'] })
      outer = f
    }
    return frames.length ? { frames } : {}
  }
}
