// free of Vue and the DOM so Node imports it in the tests; data built before circuits gives flat lists
import type { Schematic, SchematicCircuit, SchematicNet, SchematicPart } from '@pcbjs/core/site-data'

type Sch = Partial<Schematic> | null | undefined

// natural ref order, as compareRefs in schematic.ts; repeated here so Node can import this file alone
function compareRefs(a: string, b: string): number {
  const ra = /^(.*?)(\d+)$/.exec(a), rb = /^(.*?)(\d+)$/.exec(b)
  if (ra && rb && ra[1] === rb[1]) return +ra[2] - +rb[2]
  return a < b ? -1 : a > b ? 1 : 0
}

/** The key of an instance in the view state and the tree: its path joined with "/", as local net names are. */
export const instanceKey = (path: readonly string[]): string => path.join('/')
/** An instance path as the viewer shows it, "Buck1 / Inner". */
export const pathLabel = (path: readonly string[]): string => path.join(' / ')

export const hasCircuits = (sch: Sch): boolean => !!sch?.circuits?.length

/** The instance with this key, null when the schematic lacks it. */
export function findInstance(sch: Sch, key: string | null | undefined): SchematicCircuit | null {
  if (key == null) return null
  return sch?.circuits?.find(g => Array.isArray(g.path) && instanceKey(g.path) === key) ?? null
}

/** One row of the tree: a part, or an instance with its own parts and child instances. */
export type TreeNode = PartNode | InstanceNode
export interface PartNode { kind: 'part'; key: string; part: SchematicPart }
export interface InstanceNode {
  kind: 'instance'; key: string; circuit: SchematicCircuit
  /** the instance's own parts in ref order, then its child instances */
  children: TreeNode[]
  /** every part ref of the instance and of its descendants, in ref order */
  refs: string[]
}

const isPrefix = (p: readonly string[], q: readonly string[]) => p.length <= q.length && p.every((s, i) => s === q[i])
const partPath = (p: SchematicPart): string[] => (Array.isArray(p.path) ? p.path : [])

/** The instance tree: board-level parts, then instances in declaration order; without circuits the flat parts. */
export function buildTree(sch: Sch): TreeNode[] {
  const parts = [...(sch?.parts ?? [])].sort((a, b) => compareRefs(a.ref, b.ref))
  const circuits = (sch?.circuits ?? []).filter(g => g && Array.isArray(g.path) && g.path.length)
  const partNode = (p: SchematicPart): PartNode => ({ kind: 'part', key: `part:${p.ref}`, part: p })
  if (!circuits.length) return parts.map(partNode)

  const byKey = new Map(circuits.map(g => [instanceKey(g.path), g]))
  // a part's instance: the path it carries, else the deepest instance listing it
  const owner = new Map<string, string>()
  for (const g of [...circuits].sort((a, b) => a.path.length - b.path.length)) for (const r of g.parts ?? []) owner.set(r, instanceKey(g.path))
  for (const p of parts) { const k = instanceKey(partPath(p)); if (k && byKey.has(k)) owner.set(p.ref, k) }
  const ownParts = new Map<string, SchematicPart[]>()
  const root: TreeNode[] = []
  for (const p of parts) {
    const k = owner.get(p.ref)
    if (k && byKey.has(k)) { let l = ownParts.get(k); if (!l) ownParts.set(k, l = []); l.push(p) } else root.push(partNode(p))
  }
  // the parent of an instance is the longest other instance path that prefixes its own
  const parentOf = (g: SchematicCircuit): string | null => {
    for (let n = g.path.length - 1; n > 0; n--) { const k = instanceKey(g.path.slice(0, n)); if (byKey.has(k)) return k }
    return null
  }
  const kids = new Map<string, SchematicCircuit[]>()
  const tops: SchematicCircuit[] = []
  for (const g of circuits) { const p = parentOf(g); if (p) { let l = kids.get(p); if (!l) kids.set(p, l = []); l.push(g) } else tops.push(g) }
  const seen = new Set<string>()
  const node = (g: SchematicCircuit): InstanceNode => {
    const key = instanceKey(g.path)
    seen.add(key)
    // child instances in the order the instance lists them, then any others
    const order = g.children ?? []
    const ch = [...(kids.get(key) ?? [])].filter(c => !seen.has(instanceKey(c.path)))
      .sort((a, b) => rank(order, a.name ?? a.path.at(-1)!) - rank(order, b.name ?? b.path.at(-1)!))
    const childNodes = ch.map(node)
    const own = (ownParts.get(key) ?? []).map(partNode)
    const refs = [...own.map(n => n.part.ref), ...childNodes.flatMap(c => c.refs), ...(g.parts ?? [])]
    return { kind: 'instance', key, circuit: g, children: [...own, ...childNodes], refs: [...new Set(refs)].sort(compareRefs) }
  }
  return [...root, ...tops.map(node)]
}
const rank = (order: readonly string[], name: string) => { const i = order.indexOf(name); return i < 0 ? Infinity : i }

/** Every instance node of a tree, depth first. */
export function instanceNodes(nodes: readonly TreeNode[]): InstanceNode[] {
  const out: InstanceNode[] = []
  const walk = (ns: readonly TreeNode[]) => { for (const n of ns) if (n.kind === 'instance') { out.push(n); walk(n.children) } }
  walk(nodes)
  return out
}

/** Every part ref of an instance and of its descendants, in ref order; [] for an unknown key. */
export function instanceRefs(sch: Sch, key: string | null | undefined): string[] {
  if (key == null) return []
  return instanceNodes(buildTree(sch)).find(n => n.key === key)?.refs ?? []
}

/** The keys of an instance's ancestors and its own, outermost first, so the tree can open down to it. */
export const ancestorKeys = (path: readonly string[]): string[] => path.map((_, i) => instanceKey(path.slice(0, i + 1)))

/** The tree under a filter: a matching instance keeps its subtree, others keep only matching rows and open. */
export function filterTree(nodes: readonly TreeNode[], query: string): { nodes: TreeNode[]; open: Set<string>; parts: number } {
  const q = query.trim().toLowerCase()
  const open = new Set<string>()
  const count = (ns: readonly TreeNode[]): number => ns.reduce((s, n) => s + (n.kind === 'part' ? 1 : count(n.children)), 0)
  if (!q) return { nodes: [...nodes], open, parts: count(nodes) }
  const has = (s: string | null | undefined) => !!s && s.toLowerCase().includes(q)
  const partHit = (p: SchematicPart) => has(p.ref) || has(p.local) || has(p.value) || has(p.footprint) || (p.pins ?? []).some(x => has(x.net))
  const walk = (ns: readonly TreeNode[]): TreeNode[] => {
    const out: TreeNode[] = []
    for (const n of ns) {
      if (n.kind === 'part') { if (partHit(n.part)) out.push(n); continue }
      const g = n.circuit
      if (has(g.name) || has(g.circuit) || has(g.layout) || has(pathLabel(g.path))) { out.push(n); continue }
      const ch = walk(n.children)
      if (ch.length) { open.add(n.key); out.push({ ...n, children: ch }) }
    }
    return out
  }
  const kept = walk(nodes)
  return { nodes: kept, open, parts: count(kept) }
}

/** The nets an instance owns: its local nets, in declaration order. */
export const instanceNets = (sch: Sch, path: readonly string[] | null | undefined): SchematicNet[] =>
  path?.length ? (sch?.nets ?? []).filter(n => Array.isArray(n.path) && n.path.length === path.length && isPrefix(path, n.path)) : []

/** A net name split for display: the owning instance as a muted prefix, "Buck1 / ", and "FB" for "Buck1/FB". */
export function netLabel(n: { name: string; path?: readonly string[] | null }): { prefix: string; name: string } {
  const p = Array.isArray(n.path) ? n.path : []
  if (!p.length) return { prefix: '', name: n.name }
  const q = instanceKey(p) + '/'
  return { prefix: pathLabel(p) + ' / ', name: n.name.startsWith(q) && n.name.length > q.length ? n.name.slice(q.length) : n.name }
}

/** The Path line of the Part tab: one link per instance, outermost first, then the part's local key; null for a board-level part. */
export function partPathLinks(p: Pick<SchematicPart, 'ref'> & { path?: readonly string[] | null; local?: string | null } | null | undefined): { links: { name: string; key: string }[]; local: string } | null {
  const path = Array.isArray(p?.path) ? p!.path : []
  if (!p || !path.length) return null
  return { links: path.map((name, i) => ({ name, key: instanceKey(path.slice(0, i + 1)) })), local: p.local || p.ref }
}

/** The box around the placed footprints of some refs, board mm, null when none is placed. */
export function refsBox(footprints: readonly { ref: string; bbox?: { x: number; y: number; w: number; h: number }; at: [number, number] }[], refs: readonly string[]): { at: [number, number]; w: number; h: number } | null {
  const want = new Set(refs)
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const f of footprints) {
    if (!want.has(f.ref)) continue
    const b = f.bbox ?? { x: f.at[0], y: f.at[1], w: 0, h: 0 }
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h)
  }
  return x0 <= x1 ? { at: [(x0 + x1) / 2, (y0 + y1) / 2], w: x1 - x0, h: y1 - y0 } : null
}

/** The innermost source range that produced every one of these refs, for Show in source of an instance; null when none covers them all. */
export function enclosingRange(sources: Record<string, { start: [number, number]; end: [number, number]; ids: number[]; refs: string[] }[]> | null | undefined, refs: readonly string[]): { file: string; range: { start: [number, number]; end: [number, number]; ids: number[]; refs: string[] } } | null {
  if (!sources || !refs.length) return null
  let best: { file: string; range: { start: [number, number]; end: [number, number]; ids: number[]; refs: string[] } } | null = null
  for (const [file, ranges] of Object.entries(sources)) for (const r of ranges) {
    if (!refs.every(x => r.refs.includes(x))) continue
    if (!best || r.refs.length < best.range.refs.length) best = { file, range: r }
  }
  return best
}
