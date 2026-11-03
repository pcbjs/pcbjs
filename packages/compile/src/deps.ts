import type { AutoRouteJob, Board } from '@pcbjs/core/model'
import type { RouteEnd } from '@pcbjs/core/internal/types'
import type { DepGraph, DepNode } from '@pcbjs/core/internal/plugin'
import { padOf } from './autoroute.js'
import type { ReferenceJob } from './reference.js'
import { CompileError } from './flatten.js'

/** What auto placement adds to the graph: followers by the route they follow, the solvers of parts and routes, and what each solver read. */
export interface PlaceDeps {
  followers?: { ref: string; route: string }[]
  solvers?: DepNode[]
  /** a solver's ref to the part it read */
  reads?: [string, string][]
  /** each grid: the parts its origin or frame reads, the grid it sits in and the parts placed under it */
  grids?: { name: string; src?: DepNode['src']; reads: string[]; parent: string | null; parts: string[] }[]
}

/** The placement dependency graph of a placed board: parts, followers to the route they follow, routes to the parts they end on, solvers to what they read, references. */
export function depGraph(board: Board, jobs: readonly AutoRouteJob[], references: readonly ReferenceJob[] = [], place: PlaceDeps = {}): DepGraph {
  const nodes: DepNode[] = []
  const edges: DepGraph['edges'] = []
  const parts = new Map<string, number>()
  const follows = new Map((place.followers ?? []).map(f => [f.ref, f.route]))
  for (const fp of board.footprints) parts.set(fp.ref, nodes.push({ kind: follows.has(fp.ref) ? 'follower' : 'part', ref: fp.ref, ...(fp.src ? { src: fp.src } : {}) }) - 1)
  const routes = new Map<string, number>()
  for (const job of jobs) {
    if (job.route === undefined) continue
    let at = routes.get(job.route)
    if (at === undefined) routes.set(job.route, (at = nodes.push({ kind: 'route', ref: job.route, ...(job.src ? { src: job.src } : {}) }) - 1))
    for (const ref of endParts(board, job)) {
      const to = parts.get(ref)
      if (to !== undefined && !edges.some(([a, b]) => a === at && b === to)) edges.push([at, to, 'end'])
    }
  }
  for (const [ref, route] of follows) {
    let to = routes.get(route)
    if (to === undefined) routes.set(route, (to = nodes.push({ kind: 'route', ref: route }) - 1))
    edges.push([parts.get(ref)!, to, 'follow'])
  }
  for (const s of place.solvers ?? []) {
    const at = nodes.push(s) - 1
    for (const [who, ref] of place.reads ?? []) if (who === s.ref && parts.has(ref)) edges.push([at, parts.get(ref)!, 'read'])
  }
  const grids = new Map<string, number>()
  for (const g of place.grids ?? []) grids.set(g.name, nodes.push({ kind: 'grid', ref: g.name, ...(g.src ? { src: g.src } : {}) }) - 1)
  for (const g of place.grids ?? []) {
    const at = grids.get(g.name)!
    for (const ref of g.reads) if (parts.has(ref)) edges.push([at, parts.get(ref)!, 'anchor'])
    for (const ref of g.parts) if (parts.has(ref)) edges.push([parts.get(ref)!, at, 'grid'])
    if (g.parent !== null && grids.has(g.parent)) edges.push([at, grids.get(g.parent)!, 'grid'])
  }
  for (const r of references) nodes.push({ kind: 'reference', ref: String(r.props.path), ...(r.src ? { src: r.src } : {}) })
  return { nodes, edges }
}

/** `solver-order`: a solver read `target`, a result made after it or by itself. */
export function solverOrder(solver: DepNode, target: DepNode): CycleError {
  const e = new CycleError('solver-order', target.ref === solver.ref ? [solver] : [solver, target], '', solver.src)
  if (e.members.length > 1) e.message = `a solver reads a result made after it: ${named(solver)} → ${named(target)}`
  return e
}

/** The refs of the parts whose pads a route job ends on, in the order of its ends. */
export function endParts(board: Board, job: AutoRouteJob): string[] {
  const ends: (RouteEnd | undefined)[] = [job.from, job.to, job.root, job.pair?.fromN, job.pair?.toN]
  const refs = ends.flatMap(e => (e === undefined ? [] : [padOf(board, e)?.ref]))
  if (job.whole && job.net !== undefined) for (const it of board.items) if (it.kind === 'pad' && it.net === job.net) refs.push(it.ref)
  return [...new Set(refs.filter((r): r is string => !!r))]
}

export type CycleCode = 'grid-cycle' | 'follow-cycle' | 'solver-order' | 'reference-cycle'
const WHAT: Record<CycleCode, string> = {
  'grid-cycle': 'a grid cycle',
  'follow-cycle': 'a follower cycle',
  'solver-order': 'a solver reads its own result',
  'reference-cycle': 'a reference cycle',
}

const named = (m: DepNode) => (m.src ? `${m.ref} (${m.src.file}:${m.src.line}:${m.src.col})` : m.ref)

/** A dependency cycle: a compile error, `code` saying which kind, naming each member by reference and source. */
export class CycleError extends CompileError {
  constructor(
    public code: CycleCode,
    public members: DepNode[],
    /** the calls that led to it, such as `reference("../b/pcb.tsx"): ` */
    public prefix = '',
    src = members[0].src,
  ) {
    super(`${prefix}${WHAT[code]}: ${[...members.map(named), members[0].ref].join(' → ')}`, src)
    this.name = 'CycleError'
  }
}

/** The kind of a strongly connected component: by a grid in it, else a follower, a solver, an entry. */
function codeOf(members: DepNode[]): CycleCode {
  const has = (k: DepNode['kind']) => members.some(m => m.kind === k)
  if (has('grid')) return 'grid-cycle'
  if (has('follower')) return 'follow-cycle'
  if (has('solver')) return 'solver-order'
  if (has('reference')) return 'reference-cycle'
  // only parts and routes: a part placed on another's pad, as a grid anchor is
  return 'grid-cycle'
}

/** Every strongly connected component of two or more nodes and every node with an edge to itself, members in graph order; Tarjan. */
export function cyclesOf(g: DepGraph): number[][] {
  const next = g.nodes.map(() => [] as number[])
  for (const [a, b] of g.edges) next[a].push(b)
  const index = g.nodes.map(() => -1)
  const low: number[] = []
  const on: boolean[] = []
  const stack: number[] = []
  const out: number[][] = []
  let n = 0
  const visit = (v: number) => {
    index[v] = low[v] = n++
    stack.push(v)
    on[v] = true
    for (const w of next[v]) {
      if (index[w] < 0) {
        visit(w)
        low[v] = Math.min(low[v], low[w])
      } else if (on[w]) low[v] = Math.min(low[v], index[w])
    }
    if (low[v] !== index[v]) return
    const scc: number[] = []
    let w: number
    do {
      w = stack.pop()!
      on[w] = false
      scc.push(w)
    } while (w !== v)
    if (scc.length > 1 || next[v].includes(v)) out.push(scc.sort((a, b) => a - b))
  }
  for (let v = 0; v < g.nodes.length; v++) if (index[v] < 0) visit(v)
  return out.sort((a, b) => a[0] - b[0])
}

/** The first cycle of the graph as a CycleError; nothing when it has none. */
export function checkCycles(g: DepGraph): void {
  const [first] = cyclesOf(g)
  if (!first) return
  const members = first.map(i => g.nodes[i])
  throw new CycleError(codeOf(members), members)
}
