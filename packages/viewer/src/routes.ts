// free of Vue and the DOM so Node imports it in the tests; data built before the router reported routes gives nothing
import type { RouteInfo } from '@pcbjs/core/site-data'

/** The part of a site item these functions read. */
export interface TrackLike {
  id: number
  kind: string
  net?: string
  pair?: string
  role?: 'P' | 'N'
  width?: number
}
interface BoardLike {
  routes?: RouteInfo[]
  items?: TrackLike[]
}

/** Lengths within this of a bound count as on it: the router's own resolution. */
const EPS = 1e-6
const mm = (v: number) => `${+v.toFixed(2)} mm`

/** The pair an item belongs to, null for anything but a track of a pair. */
export const pairOf = (it: TrackLike | null | undefined): string | null => (it && it.kind === 'track' && it.pair ? it.pair : null)

/** The nets of a pair, P first, from its tracks. */
export function pairNets(board: BoardLike, pair: string): string[] {
  let p: string | undefined, n: string | undefined
  for (const it of board.items ?? []) {
    if (it.kind !== 'track' || it.pair !== pair || !it.net) continue
    if (it.role === 'N') n ??= it.net
    else p ??= it.net
  }
  return [p, n].filter((x): x is string => !!x)
}

const groupCache = new WeakMap<BoardLike, Map<string, string[]>>()

/** Every net of a pair group by net: the nets the pair routes name, joined where they share one; a net of no pair is absent. */
export function pairGroups(board: BoardLike): Map<string, string[]> {
  let out = groupCache.get(board)
  if (out) return out
  const up = new Map<string, string>()
  const find = (x: string): string => {
    while (up.get(x) !== x) x = up.get(x)!
    return x
  }
  for (const r of board.routes ?? []) {
    if (!r.pair) continue
    const nets = r.nets ?? [r.net, ...pairNets(board, r.pair)]
    for (const x of nets) if (!up.has(x)) up.set(x, x)
    for (const x of nets) up.set(find(x), find(nets[0]))
  }
  const by = new Map<string, string[]>()
  for (const x of up.keys()) {
    const k = find(x)
    by.set(k, [...(by.get(k) ?? []), x])
  }
  out = new Map([...up.keys()].map(x => [x, by.get(find(x))!]))
  groupCache.set(board, out)
  return out
}

/** What a hovered or pinned net lights: the net itself as primary, every other net of its pair group as secondary. */
export function netRoles(board: BoardLike, net: string | null | undefined): Map<string, 'primary' | 'secondary'> {
  const out = new Map<string, 'primary' | 'secondary'>()
  if (!net) return out
  for (const x of pairGroups(board).get(net) ?? []) out.set(x, 'secondary')
  return out.set(net, 'primary')
}

/** Whether a route's length is inside its target: 'short' or 'long' when outside, 'ok' inside, null without a target. */
export function lengthStatus(r: Pick<RouteInfo, 'length' | 'target'>): 'ok' | 'short' | 'long' | null {
  const t = r.target
  if (!t) return null
  if (r.length < t.min - EPS) return 'short'
  if (r.length > t.max + EPS) return 'long'
  return 'ok'
}

/** A target range as text: one number when min and max agree; a max of 1e6 or more is no maximum, a min of 0 no minimum. */
export const targetText = (t: { min: number; max: number }): string =>
  Math.abs(t.max - t.min) < EPS ? mm(t.min) : t.max >= 1e6 ? `at least ${mm(t.min)}` : t.min <= 0 ? `at most ${mm(t.max)}` : `${+t.min.toFixed(2)} to ${mm(t.max)}`

/** The routes of an item: the route of its pair for a pair track, else every route of its net. */
export function routesOf(board: BoardLike, it: TrackLike | null | undefined): RouteInfo[] {
  if (!it || !board.routes?.length) return []
  const pair = pairOf(it)
  if (pair) return board.routes.filter(r => r.pair === pair)
  return it.net ? board.routes.filter(r => r.net === it.net && !r.pair) : []
}

/** The hover text of a track with a route: net, width, length, a pair's skew and the target; null without a route. */
export function routeHover(board: BoardLike, it: TrackLike | null | undefined): string | null {
  if (!it || it.kind !== 'track') return null
  const rs = routesOf(board, it)
  if (!rs.length) return null
  const parts: string[] = []
  if (it.net) parts.push(it.net)
  if (it.width) parts.push(`${mm(it.width)} wide`)
  if (rs.length === 1) {
    const r = rs[0]
    parts.push(`length ${mm(r.length)}`)
    if (r.pair && r.skew !== undefined) parts.push(`skew ${mm(r.skew)}`)
    const st = lengthStatus(r)
    if (r.target) parts.push(`target ${targetText(r.target)}${st === 'short' ? ', too short' : st === 'long' ? ', too long' : ''}`)
    if (r.group) parts.push(`group ${r.group}`)
  } else parts.push(`${rs.length} routes, ${mm(rs.reduce((s, r) => s + r.length, 0))} in all`)
  return parts.join(', ')
}

/** What the Nets list shows beside a net with a route: the length, the target and whether the length is outside it. */
export interface NetLength {
  length: number
  routes: number
  target: { min: number; max: number } | null
  bad: boolean
  skew?: number
  title: string
}

/** The route length of every net with a route, the N net of a pair included; several routes of one net add up. */
export function netLengths(board: BoardLike): Map<string, NetLength> {
  const out = new Map<string, NetLength>()
  const add = (net: string, r: RouteInfo) => {
    const st = lengthStatus(r)
    const line = `${r.pair ? `pair ${r.pair}` : `route ${r.id}`}: ${mm(r.length)}${r.target ? `, target ${targetText(r.target)}` : ''}${st === 'short' ? ', too short' : st === 'long' ? ', too long' : ''}${r.skew !== undefined ? `, skew ${mm(r.skew)}` : ''}${r.group ? `, group ${r.group}` : ''}`
    const e = out.get(net)
    if (!e) {
      out.set(net, { length: r.length, routes: 1, target: r.target ?? null, bad: st === 'short' || st === 'long', ...(r.skew !== undefined ? { skew: r.skew } : {}), title: line })
      return
    }
    e.length += r.length
    e.routes++
    e.target = e.target ?? r.target ?? null
    e.bad ||= st === 'short' || st === 'long'
    e.title += `\n${line}`
  }
  for (const r of board.routes ?? []) {
    const nets = r.pair ? pairNets(board, r.pair) : []
    if (!nets.includes(r.net)) nets.unshift(r.net)
    for (const n of nets) add(n, r)
  }
  return out
}
