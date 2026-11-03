// The copper of two compiles of one board compared item by item: unchanged by uid and rev, or by geometry when a side mints no uids,
// then what is left paired by identity, its uid, else a pad by part and number, a routed track or via by its route, layer and net, as moved.
import type { Board, Item, Pt } from '@pcbjs/core/model'
import type { Finding } from '@pcbjs/core/finding'
import { itemRev } from '@pcbjs/core/ref'

export type Change = 'added' | 'removed' | 'moved'

export interface Changed {
  change: Change
  /** the uid after, before for a removed item */
  uid: string | null
  /** a moved item's uid before */
  was?: string | null
  /** a pad as `R1/2`, a routed track or via by its route, else its uid */
  ref: string
  kind: Item['kind']
  layer: string
  net: string | null
  /** the item's centre in board mm, after; a removed one's before */
  at: Pt
  /** a moved item's centre before */
  from?: Pt
}

export interface ItemDiff {
  /** uid when both sides mint uids, else geometry */
  by: 'uid' | 'geometry'
  items: Changed[]
  /** the numeric ids of each side's changed items, for the drawing */
  ids: { before: Map<number, Change>; after: Map<number, Change> }
}

const um = (v: number) => Math.round(v * 1e3)
const pts = (r: Pt[]) => r.map(p => `${um(p[0])},${um(p[1])}`).join(' ')

/** The copper items: pads and vias always, the rest on a copper layer, those on `layers` alone when given. */
export function copperItems(board: Board, layers?: string[]): Item[] {
  const cu = new Set(board.layers.filter(l => l.kind === 'copper').map(l => l.id))
  const on = (it: Item) => {
    const ls = it.kind === 'pad' ? it.layers : it.kind === 'via' ? it.layers : [it.layer]
    return !layers?.length || ls.some(l => layers.includes(l)) || (it.kind === 'via' && layers.some(l => cu.has(l)))
  }
  return board.items.filter(it => (it.kind === 'pad' || it.kind === 'via' || cu.has(it.layer)) && on(it))
}

/** Kind, layers, net and the geometry to 1 µm: equal for the same copper in two compiles. */
export function geometryKey(it: Item): string {
  const head = `${it.kind}|${it.layer}|${it.net ?? ''}|`
  switch (it.kind) {
    case 'track':
      return head + `${um(it.width)}|${pts(it.pts)}`
    case 'via':
      return head + `${pts([it.at])}|${um(it.drill)}|${um(it.size)}|${it.layers.join()}`
    case 'pad':
      return head + `${it.ref}|${it.num}|${pts(it.poly)}`
    case 'zone':
      return head + `${it.priority}|${it.outline.map(pts).join('|')}`
    case 'graphic':
      return head + `${um(it.width)}|${it.paths.map(pts).join('|')}`
    case 'text':
      return head + `${it.text}|${pts([it.at])}|${um(it.size)}`
  }
}

const routeRef = (r: string) => (r.startsWith('route:') ? r : `route:${r}`)

/** What stays the same when an item moves. */
export function identity(it: Item): string {
  if (it.uid) return it.uid
  if (it.kind === 'pad') return `pad|${it.ref ?? ''}|${it.num}`
  if ((it.kind === 'track' || it.kind === 'via') && it.route) return `${it.kind}|${it.route}|${it.layer}|${it.net ?? ''}`
  return `${it.kind}|${it.layer}|${it.net ?? ''}|${it.ref ?? ''}|${it.src?.file ?? ''}`
}

export function centre(it: Item): Pt {
  const ring: Pt[] =
    it.kind === 'track'
      ? it.pts
      : it.kind === 'zone'
        ? it.outline.flat()
        : it.kind === 'graphic'
          ? it.paths.flat()
          : it.kind === 'pad' || it.kind === 'via' || it.kind === 'text'
            ? [it.at]
            : []
  if (!ring.length) return [0, 0]
  const xs = ring.map(p => p[0]),
    ys = ring.map(p => p[1])
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]
}

function refOf(it: Item): string {
  if (it.kind === 'pad' && it.ref) return `${it.ref}/${it.num}`
  if ((it.kind === 'track' || it.kind === 'via') && it.route) return routeRef(it.route)
  return it.uid ?? (it.net ? `net:${it.net}` : `${it.kind}:${it.id}`)
}

/** The items of `a` without a twin of the same key in `b`, each twin used once. */
function unmatched<T>(a: T[], b: T[], key: (x: T) => string): T[] {
  const left = new Map<string, number>()
  for (const x of b) left.set(key(x), (left.get(key(x)) ?? 0) + 1)
  return a.filter(x => {
    const n = left.get(key(x)) ?? 0
    if (n) left.set(key(x), n - 1)
    return !n
  })
}

const dist = (p: Pt, q: Pt) => Math.hypot(p[0] - q[0], p[1] - q[1])

/** Removed and added items of one identity paired nearest first. */
function pairMoved(gone: Item[], come: Item[]): [Item, Item][] {
  const groups = new Map<string, { g: Item[]; c: Item[] }>()
  for (const it of gone) (groups.get(identity(it)) ?? groups.set(identity(it), { g: [], c: [] }).get(identity(it))!).g.push(it)
  for (const it of come) groups.get(identity(it))?.c.push(it)
  const out: [Item, Item][] = []
  for (const { g, c } of groups.values()) {
    const cand = g.flatMap(a => c.map(b => ({ a, b, d: dist(centre(a), centre(b)) }))).sort((x, y) => x.d - y.d)
    const used = new Set<Item>()
    for (const { a, b } of cand) if (!used.has(a) && !used.has(b)) (used.add(a).add(b), out.push([a, b]))
  }
  return out
}

const row = (change: Change, it: Item, extra: Partial<Changed> = {}): Changed => ({
  change,
  uid: it.uid ?? null,
  ref: refOf(it),
  kind: it.kind,
  layer: it.layer,
  net: it.net ?? null,
  at: centre(it),
  ...extra,
})

export function diffItems(before: Board, after: Board, layers?: string[]): ItemDiff {
  const a = copperItems(before, layers),
    b = copperItems(after, layers)
  const by = [...a, ...b].every(it => it.uid) ? 'uid' : 'geometry'
  const key = by === 'uid' ? (it: Item) => `${it.uid}|${itemRev(it)}` : geometryKey
  const gone = unmatched(a, b, key),
    come = unmatched(b, a, key)
  const moved = pairMoved(gone, come)
  const paired = new Set(moved.flat())
  const items = [
    ...gone.filter(it => !paired.has(it)).map(it => row('removed', it)),
    ...come.filter(it => !paired.has(it)).map(it => row('added', it)),
    ...moved.map(([was, now]) => row('moved', now, { was: was.uid ?? null, from: centre(was) })),
  ]
  const ids = { before: new Map<number, Change>(), after: new Map<number, Change>() }
  for (const it of gone) ids.before.set(it.id, paired.has(it) ? 'moved' : 'removed')
  for (const it of come) ids.after.set(it.id, paired.has(it) ? 'moved' : 'added')
  return { by, items, ids }
}

export interface FindingRow {
  id: string
  fingerprint: string
  severity: Finding['severity']
  rule: string
  message: string
}

const findingRow = (f: Finding): FindingRow => ({ id: f.id, fingerprint: f.fingerprint, severity: f.severity, rule: f.rule, message: f.message })

/** Findings new in `after` and gone from `before`, matched by fingerprint, each once. */
export function findingsDelta(before: Finding[], after: Finding[]): { new: FindingRow[]; fixed: FindingRow[] } {
  const key = (f: Finding) => f.fingerprint
  const fresh = unmatched(after, before, key),
    fixed = unmatched(before, after, key)
  return { new: fresh.map(findingRow), fixed: fixed.map(findingRow) }
}
