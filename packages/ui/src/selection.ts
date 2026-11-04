// The selection model against one board's tree: click resolution per modifier, entering and leaving isolation, Escape and what
// the members draw. Free of Vue and the DOM, written as erasable TypeScript so Node imports it in the tests.
import type { SiteData, SiteItem } from '@pcbjs/core/site-data'
import { emptySelection, withoutRef, type Isolation, type Ref, type Selection } from '@pcbjs/core/internal/selection'
import { cornersOf, displayRef, legAt, refPart, siteTarget } from './refs'
import { isTreeRef, refNet, refRoute } from '@pcbjs/core/ref'
import { compassBox } from './ring'
import { defName, frameOf, reachOf, shownDef } from '@pcbjs/core/internal/instances'

export { emptySelection, withoutRef }
export type { Isolation, Ref, Selection }

type Pt = [number, number]
type Box = [number, number, number, number]
export type Site = Pick<SiteData, 'name' | 'footprints' | 'nets' | 'drc' | 'erc' | 'schematic'> & Partial<Pick<SiteData, 'items' | 'routes' | 'edit'>>

/** What the pointer is on, as a view reports it; `at` in board mm. */
export interface Hit {
  kind: string
  id?: number | null
  ref?: string | null
  net?: string | null
  pad?: string | null
  at?: Pt | null
}
/** shift extends or toggles; deep, cmd or ctrl, reaches the leaf. */
export interface Mods {
  shift: boolean
  deep: boolean
  /** alt, option on a Mac: open the definition of what a plain click selects, the selection kept */
  alt?: boolean
}

interface Tree {
  /** each part's tree path, outermost first */
  parts: Map<string, string[]>
  groups: Set<string>
  /** each group's parts, by its path joined with "/" */
  members: Map<string, string[]>
  items: Map<number, SiteItem>
  /** the group path a route belongs to, from the instance whose layout made it */
  routes: Map<string, string[]>
}

const trees = new WeakMap<object, Tree>()
function treeOf(site: Site): Tree {
  let t = trees.get(site)
  if (t) return t
  const sch = new Map((site.schematic?.parts ?? []).map(p => [p.ref, p]))
  const parts = new Map(
    [...new Set([...site.footprints.map(f => f.ref), ...site.schematic.parts.filter(p => p.displayRef).map(p => p.ref)])].map(ref => {
      const p = sch.get(ref)
      return [ref, p?.path?.length ? [...p.path, p.local ?? ref] : [ref]] as const
    }),
  )
  const groups = new Set((site.schematic?.circuits ?? []).map(c => c.path.join('/')))
  const members = new Map<string, string[]>()
  for (const [ref, path] of parts)
    for (let k = 1; k < path.length; k++) {
      const g = path.slice(0, k).join('/')
      members.set(g, [...(members.get(g) ?? []), ref])
    }
  const routes = new Map((site.routes ?? []).filter(r => r.path).map(r => [r.id, r.path!.split('/')]))
  t = { parts, groups, members, items: new Map((site.items ?? []).map(it => [it.id, it])), routes }
  trees.set(site, t)
  return t
}

const prefixes = (path: readonly string[]): string[] => path.map((_, k) => path.slice(0, k + 1).join('/'))

/** A part's reference: its tree path, `CH2/R01`, else its ref. */
export function partRefOf(site: Site, ref: string): string {
  return (treeOf(site).parts.get(ref) ?? [ref]).join('/')
}

/** The pad number of a pad item: its own, else the footprint pad whose centre its outline holds. */
function padNum(site: Site, it: SiteItem | undefined, hit: Hit): string | null {
  const fp = site.footprints.find(f => f.ref === (hit.ref ?? it?.ref))
  if (hit.pad) return (fp?.pads.find(p => p.num === hit.pad) ?? fp?.pads.find(p => p.name === hit.pad))?.num ?? hit.pad
  if (!fp || !it) return null
  const b = boxOfRings(cornersOf(it))
  const p = b && fp.pads.find(p => p.at[0] >= b[0] && p.at[0] <= b[0] + b[2] && p.at[1] >= b[1] && p.at[1] <= b[1] + b[3])
  return p ? p.num : null
}

/** Every level from the root to the leaf under the pointer, outermost first: groups, part, pad; or the route's group, the route and its automatic leg; a schematic wire's or a ratsnest line's net, a sheet's group; or a bare item. */
export function hitPath(site: Site, hit: Hit | null): Ref[] {
  if (!hit) return []
  const t = treeOf(site)
  if (hit.kind === 'sheet' && hit.ref) return prefixes(hit.ref.split('/'))
  if ((hit.kind === 'wire' || hit.kind === 'label' || hit.kind === 'rats') && hit.net) return [`net:${hit.net}`]
  const it = hit.id != null ? t.items.get(hit.id) : undefined
  const route = it?.route
  if (route) {
    const leg = legAt(site, route, hit.at)
    return [...prefixes(t.routes.get(route) ?? []), route, ...(leg ? [`${route}/leg:${leg}`] : [])]
  }
  const ref = hit.ref ?? it?.ref
  if (ref && t.parts.has(ref)) {
    const path = prefixes(t.parts.get(ref)!)
    const num = (hit.kind === 'pad' || hit.kind === 'pin' || it?.kind === 'pad') && padNum(site, it, hit)
    return num ? [...path, `${path[path.length - 1]}/${num}`] : path
  }
  const net = hit.net ?? it?.net
  if ((hit.kind === 'zone' || it?.kind === 'zone') && net && it) return [`plane:${it.layers[0]}:${net}`]
  // a text or graphic an instance's layout drew sits under that instance
  return it?.uid ? [...(it.path ? prefixes(it.path.split('/')) : []), it.uid] : []
}

/** The ancestors of a member in the tree, outermost first. */
export function lineage(site: Site, ref: Ref): Ref[] {
  const t = treeOf(site)
  const route = /^(route:[^/]+)(\/.*)?$/.exec(ref)
  if (route) return [...prefixes(t.routes.get(route[1]) ?? []), ...(route[2] ? [route[1]] : [])]
  const segs = ref.split('/')
  if (!isTreeRef(ref)) return []
  return prefixes(segs).slice(0, -1)
}

const related = (site: Site, a: Ref, b: Ref) => a === b || lineage(site, b).includes(a) || lineage(site, a).includes(b)

/** The root of a selection: the isolated definition's instance, else the board. */
const rootOf = (sel: Selection): Ref | null => sel.isolate?.ref ?? null

/** Add a member as the anchor, dropping its ancestors and descendants; a member already there leaves, the anchor passing to the one before it. */
export function toggle(sel: Selection, site: Site, ref: Ref): Selection {
  if (sel.refs.includes(ref)) return withoutRef(sel, ref)
  return { ...sel, refs: [...sel.refs.filter(r => !related(site, r, ref)), ref], anchor: ref }
}

/** Replace the selection with these members, the last the anchor unless one is named; the isolation is kept. */
export function selectRefs(sel: Selection, refs: Ref[], anchor: Ref | null = refs[refs.length - 1] ?? null): Selection {
  const list = [...new Set(refs)]
  return { ...sel, refs: list, anchor: anchor && list.includes(anchor) ? anchor : (list[list.length - 1] ?? null) }
}

/** The index in a hit's path of what a plain click selects, and the selected group it enters; -1 for a hit outside an isolation. */
function plainAt(sel: Selection, site: Site, path: Ref[], entering = true): { i: number; enters: Ref | null } {
  const root = rootOf(sel)
  if (root && !path.includes(root)) return { i: -1, enters: null }
  const base = root ? path.indexOf(root) : -1
  // a click on an entity of a selected group enters that group's definition with the entity's level-child selected
  const k = !entering ? -1 : path.findIndex((r, j) => j > base && j < path.length - 1 && sel.refs.includes(r) && isGroup(site, r))
  if (k >= 0) return { i: k + 1, enters: path[k] }
  return { i: Math.min(base + 1, path.length - 1), enters: null }
}

/** What a click would select now: the child of the root on the path to the hit, inside a selected group its child, or with `deep` the leaf; null for nothing. */
export function clickTarget(sel: Selection, site: Site, hit: Hit | null, deep: boolean): Ref | null {
  const path = hitPath(site, hit)
  if (!path.length) return null
  const { i } = plainAt(sel, site, path)
  if (i < 0) return null
  return deep ? path[path.length - 1] : path[i]
}

/** A click: select what clickTarget names, shift toggling it, a plain click inside a selected group entering its definition; on empty board clear, shift keeping everything. */
export function click(sel: Selection, site: Site, hit: Hit | null, mods: Mods): Selection {
  const path = hitPath(site, hit)
  if (!path.length) return mods.shift ? sel : { ...sel, refs: [], anchor: null }
  const { i, enters } = plainAt(sel, site, path, !mods.shift)
  if (i < 0) return sel
  let pick = mods.deep ? path[path.length - 1] : path[i]
  if (/^route:\d+$/.test(pick) && hit?.kind === 'track' && hit.at) {
    const pts = site.routes?.find(r => r.id === pick)?.pts
    const steps = site.edit?.find(e => e.ref === pick)?.steps
    let best = Infinity,
      end = 0
    for (let j = 0; pts && j + 1 < pts.length; j++) {
      if (!/^[LlHhVvAa]$/.test(steps?.[j]?.op ?? '')) continue
      const a = pts[j],
        b = pts[j + 1],
        dx = b[0] - a[0],
        dy = b[1] - a[1]
      const t = Math.max(0, Math.min(1, ((hit.at[0] - a[0]) * dx + (hit.at[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)))
      const distance = Math.hypot(hit.at[0] - a[0] - t * dx, hit.at[1] - a[1] - t * dy)
      if (distance < best) {
        best = distance
        end = j + 1
      }
    }
    if (end) pick = `${pick}/pt:${end}`
  }
  if (mods.shift) return toggle(sel, site, pick)
  if (enters && !mods.deep) return enterIsolation(sel, site, enters, pick)
  return { ...sel, refs: [pick], anchor: pick }
}

/** The control point of a route nearest a board point. */
function nearestPt(site: Site, route: Ref, at: Pt | null | undefined): Ref | null {
  const pts = site.routes?.find(r => r.id === route)?.pts
  if (!pts?.length || !at) return null
  let k = 0
  for (let j = 1; j < pts.length; j++) if (Math.hypot(pts[j][0] - at[0], pts[j][1] - at[1]) < Math.hypot(pts[k][0] - at[0], pts[k][1] - at[1])) k = j
  return `${route}/pt:${k}`
}

/** A double-click: on a group's entity, the group's definition entered with the entity's level-child selected; on a part its pad, on a route its nearest control point. */
export function enter(sel: Selection, site: Site, hit: Hit | null): Selection {
  const path = hitPath(site, hit)
  const { i, enters } = plainAt(sel, site, path)
  if (i < 0 || !path.length) return sel
  const c = path[i]
  if (enters) return enterIsolation(sel, site, enters, c)
  if (isGroup(site, c) && path[i + 1]) return enterIsolation(sel, site, c, path[i + 1])
  const child = c.startsWith('route:') ? nearestPt(site, c, hit?.at) : (path[i + 1] ?? null)
  return { ...sel, refs: [child ?? c], anchor: child ?? c }
}

/** Escape: inside an isolation a member deeper than the root's children goes up to its parent, else the isolation ends with its instance selected; on the board the selection clears. */
export function escape(sel: Selection, site: Site): Selection {
  const root = rootOf(sel)
  if (root) {
    const up = sel.anchor ? lineage(site, sel.anchor) : []
    const parent = up[up.length - 1]
    if (parent && parent !== root && up.includes(root)) return { ...sel, refs: [parent], anchor: parent }
    return leave(sel, site)
  }
  if (sel.refs.length) return { ...sel, refs: [], anchor: null }
  return sel
}

const isGroup = (site: Site, ref: Ref) => treeOf(site).groups.has(ref)
/** The part a member belongs to: a part, or the part of a pad. */
export function partOfRef(site: Site, ref: Ref | null): string | null {
  if (!ref || !isTreeRef(ref)) return null
  const t = treeOf(site)
  for (const [r, path] of t.parts) {
    const p = path.join('/')
    if (p === ref || ref.startsWith(p + '/') || r === ref) return r
  }
  return null
}

/** What Isolate enters: the anchor's group, else the innermost group around the anchor, else the anchor's part; null when there is nothing. */
export function isolateTarget(sel: Selection, site: Site): Ref | null {
  const a = sel.anchor
  if (!a) return null
  if (isGroup(site, a)) return a
  const up = lineage(site, a).filter(r => isGroup(site, r))
  if (up.length) return up[up.length - 1]
  const part = partOfRef(site, a)
  return part ? partRefOf(site, part) : null
}

const recordOf = (site: Site, ref: Ref) => site.schematic?.circuits?.find(x => x.path.join('/') === ref)

/** Every instance a write inside the definition an instance shows reaches, in document order; a part is its own only one. */
export function instancesOf(site: Site, ref: Ref): Ref[] {
  const c = recordOf(site, ref)
  return c ? reachOf(site.schematic.circuits, shownDef(c)).map(x => x.path.join('/')) : [ref]
}

/** Enter the definition of the instance `ref`, shown with its values, selecting `pick` inside it. */
function enterIsolation(sel: Selection, site: Site, ref: Ref, pick: Ref | null): Selection {
  const refs = pick && pick !== ref ? [pick] : []
  return {
    ...sel,
    isolate: { ref, context: ref, instances: instancesOf(site, ref), preview: false, ...(sel.isolate?.mode ? { mode: sel.isolate.mode } : {}) },
    level: ref,
    refs,
    anchor: refs[0] ?? null,
  }
}
/** Leave the isolation with its instance selected: to the definition of the instance around it, else to the board. */
function leave(sel: Selection, site: Site): Selection {
  const ref = sel.isolate?.ref
  const up = ref ? recordOf(site, ref)?.parent : undefined
  if (ref && up && recordOf(site, up)) return enterIsolation(sel, site, up, ref)
  return { ...sel, isolate: null, level: null, refs: ref ? [ref] : [], anchor: ref ?? null }
}

/** Isolate on what isolateTarget names, the members inside it kept, or off to the board with the instance selected. */
export function isolate(sel: Selection, site: Site): Selection {
  if (sel.isolate) return leave(sel, site)
  const ref = isolateTarget(sel, site)
  if (!ref) return sel
  const pick = sel.anchor && lineage(site, sel.anchor).includes(ref) ? sel.anchor : null
  return enterIsolation(sel, site, ref, pick)
}

/** Show the definition with another instance's values; the members follow to the same place in it. */
export function showInstance(sel: Selection, ref: Ref): Selection {
  const was = sel.isolate?.ref
  if (!was) return sel
  const map = (r: Ref) => (r.startsWith(was + '/') ? ref + r.slice(was.length) : r)
  const refs = sel.refs.filter(r => r.startsWith(was + '/')).map(map)
  return {
    ...sel,
    isolate: { ...sel.isolate!, ref, context: ref },
    level: ref,
    refs,
    anchor: sel.anchor && refs.includes(map(sel.anchor)) ? map(sel.anchor) : (refs[refs.length - 1] ?? null),
  }
}

/** The parts under a reference: a group's, a part itself, a pad's part. */
export function partsUnder(site: Site, ref: Ref): string[] {
  const t = treeOf(site)
  if (t.members.has(ref)) return t.members.get(ref)!
  const p = partOfRef(site, ref)
  return p ? [p] : []
}

export function boxOfRings(rings: readonly (readonly (readonly [number, number])[])[]): Box | null {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity
  for (const r of rings)
    for (const [x, y] of r) {
      x0 = Math.min(x0, x)
      y0 = Math.min(y0, y)
      x1 = Math.max(x1, x)
      y1 = Math.max(y1, y)
    }
  return x0 <= x1 ? [x0, y0, x1 - x0, y1 - y0] : null
}
/** A 2D affine frame, `[a, b, c, d, e, f]`: x' = a x + c y + e, y' = b x + d y + f. */
export type Mat = [number, number, number, number, number, number]
export const applyMat = (m: Mat, p: readonly [number, number]): Pt => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]]
export function invertMat(m: Mat): Mat {
  const d = m[0] * m[3] - m[1] * m[2]
  const a = m[3] / d,
    b = -m[1] / d,
    c = -m[2] / d,
    e = m[0] / d
  return [a, b, c, e, -(a * m[4] + c * m[5]), -(b * m[4] + e * m[5])]
}
/** The box around a box's corners carried through a frame. */
export function boxThrough(m: Mat, b: Box): Box {
  const ps = [applyMat(m, [b[0], b[1]]), applyMat(m, [b[0] + b[2], b[1]]), applyMat(m, [b[0], b[1] + b[3]]), applyMat(m, [b[0] + b[2], b[1] + b[3]])]
  const xs = ps.map(p => p[0]),
    ys = ps.map(p => p[1])
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)]
}
const union = (a: Box | null, b: Box): Box =>
  a ? [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0] + a[2], b[0] + b[2]) - Math.min(a[0], b[0]), Math.max(a[1] + a[3], b[1] + b[3]) - Math.min(a[1], b[1])] : b

/** What an isolation shows: the definition's parts, routes, text and silk with the instance's values, in the frame of its layout; the board and the other instances hidden, or faded around a definition placed once. */
export interface IsolationView {
  parts: Set<string>
  ids: Set<number>
  findings: Set<string>
  nets: Set<string>
  fade: boolean
  /** the definition's frame on the board, board = frame · (x, y); null shows board coordinates */
  frame: Mat | null
  /** what it shows, in the shown frame */
  box: Box | null
  /** the same in board mm, framed after leaving */
  boardBox: Box | null
}
export function isolationView(site: Site, iso: Isolation): IsolationView {
  const parts = new Set(partsUnder(site, iso.ref))
  const fps = site.footprints.filter(f => parts.has(f.ref))
  const fade = iso.mode === 'library' ? false : iso.mode === 'instance' ? true : iso.instances.length <= 1
  // a net that leaves the definition draws its ratsnest to the board, which only a faded board shows
  const nets = new Set(fps.flatMap(f => f.pads.flatMap(p => (p.net && (fade || p.net.startsWith(iso.ref + '/')) ? [p.net] : []))))
  const ids = new Set(madeBy(site, iso.ref))
  for (const it of site.items ?? []) if (it.ref && parts.has(it.ref)) ids.add(it.id)
  const findings = new Set([...site.drc, ...site.erc].filter(m => m.id && (m.refs ?? []).some(r => parts.has(refPart(site, r) ?? ''))).map(m => m.id!))
  let frame = iso.mode === 'instance' ? null : frameOf(site.edit?.find(e => e.ref === iso.ref)?.frames, iso.ref)
  let boardBox: Box | null = null
  for (const f of fps) boardBox = union(boardBox, [f.bbox.x, f.bbox.y, f.bbox.w, f.bbox.h])
  for (const it of site.items ?? []) {
    const b = ids.has(it.id) && !it.ref ? boxOfRings(cornersOf(it)) : null
    if (b) boardBox = union(boardBox, b)
  }
  const n = site.edit?.find(n => n.ref === iso.ref)
  if (boardBox && n?.at) boardBox = compassBox(n.pivot ?? [n.at[0], n.at[1]], boardBox)
  if (iso.mode === 'library' && !frame && boardBox) frame = [1, 0, 0, 1, boardBox[0], boardBox[1]]
  const box = boardBox && frame ? boxThrough(invertMat(frame), boardBox) : boardBox
  return { parts, ids, findings, nets, fade, frame, box, boardBox }
}

export function isolationName(site: Site, iso: Isolation): string {
  const c = recordOf(site, iso.ref)
  return c?.layout ? defName(c.layout) : c?.kind === 'circuit' ? c.circuit! : iso.ref
}

/** Layout actions require a group; standalone part isolation changes visibility only. */
export function layoutGroup(site: Site, sel: Selection): Ref | null {
  const ref = (sel.isolate ?? sel.isolateChoice)?.ref ?? sel.anchor
  return ref && isGroup(site, ref) ? ref : null
}

/** What the members draw: parts outlined by courtyard, items by their own outline, whole nets, points; the anchor's alone, and its net as context. */
export interface Drawn {
  parts: Set<string>
  ids: Set<number>
  nets: Set<string>
  anchor: { parts: Set<string>; ids: Set<number>; nets: Set<string> }
  /** the anchor's net, drawn as context with its pair mates */
  context: string | null
  points: Pt[]
  reference: string | null
  /** wires and labels the editor's code drew, by their keys */
  sch: string[]
  /** members that name nothing on this board now */
  missing: Ref[]
}

/** The items an instance's layout or circuit made: the copper of its routes, bound or automatic, and the texts and graphics it drew. */
function madeBy(site: Site, key: string): number[] {
  const t = treeOf(site)
  const inside = (p: string | undefined) => !!p && (p === key || p.startsWith(key + '/'))
  return (site.items ?? []).filter(it => inside(it.path) || (!!it.route && inside(t.routes.get(it.route)?.join('/')))).map(it => it.id)
}

/** What one member draws on a board, null when it names nothing there. */
function memberDraw(site: Site, ref: Ref): { parts: string[]; ids: number[]; nets: string[]; net: string | null; points: Pt[] } | null {
  let t
  try {
    t = siteTarget(site, ref)
  } catch {
    return null
  }
  const none = { parts: [] as string[], ids: [] as number[], nets: [] as string[], net: null as string | null, points: [] as Pt[] }
  switch (t.kind) {
    case 'part':
      return { ...none, parts: [t.ref] }
    case 'group':
      return { ...none, parts: t.refs, ids: madeBy(site, t.key) }
    case 'pad': {
      const net = site.footprints.find(f => f.ref === t.ref)?.pads.find(p => p.num === t.num)?.net ?? null
      return { ...none, ids: t.id != null ? [t.id] : [], net }
    }
    case 'net':
      return { ...none, nets: [t.net] }
    case 'route':
      return { ...none, ids: t.ids, net: t.net }
    case 'pt':
      return { ...none, points: [t.at], net: t.net }
    case 'leg':
      return { ...none, ids: t.ids, net: t.net }
    case 'pair':
      return { ...none, ids: (site.items ?? []).filter(x => x.pair === t.pair).map(x => x.id), net: t.net }
    case 'item':
      return { ...none, ids: [t.id], net: t.net }
    case 'plane':
      return { ...none, ids: t.ids }
    case 'finding':
      return none
  }
}

/** What a hover of a click target lights in the other views and viewers: its parts, its items, and its net when it is a net; empty for none. */
export function hoverOf(site: Site, target: Ref | null): { refs: string[]; ids: number[]; net: string | null } {
  const m = target ? memberDraw(site, target) : null
  return { refs: m?.parts ?? [], ids: m?.ids ?? [], net: m?.nets[0] ?? null }
}

export function drawnOf(site: Site, sel: Selection): Drawn {
  const d: Drawn = {
    parts: new Set(),
    ids: new Set(),
    nets: new Set(),
    anchor: { parts: new Set(), ids: new Set(), nets: new Set() },
    context: null,
    points: [...(sel.marks?.points ?? [])],
    reference: sel.marks?.reference ?? null,
    sch: [...(sel.marks?.sch ?? [])],
    missing: [],
  }
  for (const ref of sel.refs) {
    const m = memberDraw(site, ref)
    if (!m) {
      d.missing.push(ref)
      continue
    }
    const into = (o: { parts: Set<string>; ids: Set<number>; nets: Set<string> }) => {
      for (const p of m.parts) o.parts.add(p)
      for (const i of m.ids) o.ids.add(i)
      for (const n of m.nets) o.nets.add(n)
    }
    into(d)
    d.points.push(...m.points)
    if (ref === sel.anchor) {
      into(d.anchor)
      d.context = m.net
    }
  }
  return d
}

/** The edit node of a member: by its ref, a part also by its tree path, `CH2/R`; a control point or a leg by its route; null for none. */
export function editNodeOf(site: Site, ref: Ref | null): NonNullable<Site['edit']>[number] | null {
  if (!ref) return null
  const base = refRoute(ref) ?? ref
  const edit = site.edit ?? []
  const own = edit.find(e => e.ref === base)
  if (own) return own
  const part = partOfRef(site, base)
  return part && partRefOf(site, part) === base ? (edit.find(e => e.ref === part) ?? null) : null
}

/** The member shown first in the chip and read by the Part tab: the anchor's part, or null. */
export const anchorPart = (site: Site, sel: Selection): string | null => partOfRef(site, sel.anchor)
/** The anchor when it is a group, for the instance panel. */
export const anchorGroup = (site: Site, sel: Selection): Ref | null => (sel.anchor && isGroup(site, sel.anchor) ? sel.anchor : null)
/** The anchor when it is a whole net. */
export const anchorNet = (sel: Selection): string | null => (sel.anchor ? refNet(sel.anchor) : null)

/** The chip's segments of a member: each prefix it can ascend to, with its label, `Group1`, `R1`, `2`. */
export function chipPath(site: Site, ref: Ref): { ref: Ref; label: string }[] {
  if (site.schematic.parts.some(p => p.displayRef) || site.footprints.some(f => f.displayRef)) return [{ ref, label: displayRef(site, ref) }]
  const up = [...lineage(site, ref), ref]
  return up.map((r, i) => ({ ref: r, label: i && r.startsWith(up[i - 1] + '/') ? r.slice(up[i - 1].length + 1) : r }))
}
