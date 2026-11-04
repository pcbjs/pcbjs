// The sidebar's trees without vscode: Boards from `pcbjs:ide:boards` and `pcbjs:ide:scopes`, Findings, Nets and BOM from
// each board's facets, `session/facets` of the project the server shows.

import * as path from 'node:path'
import type { IdeBoardsMsg, ScopesMsg } from '@pcbjs/core/protocol'
import type { SelectRequest } from './protocol'
import { boardPath } from './views'
import type { SessionLink } from './link'

interface Src {
  file: string
  line: number
  col: number
  endLine?: number
  endCol?: number
}

/** A range of a finding, 1-based, end inclusive, relative to the root. */
interface SourceRef {
  file: string
  start: [number, number]
  end: [number, number]
  role: string
}

export interface Marker {
  /** exact within one compile */
  id?: string
  /** the same finding across compiles, see docs/findings.md */
  fingerprint?: string
  severity: 'error' | 'warning' | 'info'
  rule: string
  message: string
  at: [number, number]
  layer?: string
  /** snapshot-local ids of the items it names, as `sources` lists them */
  items?: number[]
  refs?: string[]
  src?: SourceRef[]
  net?: string
}

/** The fields of the site data the trees read. */
export interface Site {
  name: string
  title?: string
  drc: Marker[]
  erc?: Marker[]
  nets: string[]
  bom: { refs: string[]; value: string; footprint: string; qty: number; fields?: Record<string, string> }[]
  footprints: { ref: string; src?: Src; pads?: { net?: string | null }[] }[]
  sources?: Record<string, { start: [number, number]; end: [number, number]; ids: number[] }[]>
  schematic?: { parts: { ref: string; path?: string[]; local?: string }[]; circuits?: { path: string[]; name?: string; circuit?: string }[] }
}

export type Action = { session?: string; project?: string; target?: string | null } & (
  | { kind: 'finding'; board: string; id: string; source?: SelectRequest }
  | { kind: 'ref'; board: string; ref: string; source?: SelectRequest }
  | { kind: 'net'; board: string; net: string }
  | { kind: 'source'; board?: string; source: SelectRequest }
  | { kind: 'board'; name: string; route?: string; entry?: string }
  | { kind: 'scope'; route: string; root: string; id: string }
  | { kind: 'diff'; left: string; right: string; title: string }
  | { kind: 'worktree'; path: string }
)

export interface Node {
  id: string
  label: string
  description?: string
  tooltip?: string
  /** a codicon id */
  icon?: string
  children?: Node[]
  load?: { root: string; entries: string[]; route?: string }
  expanded?: boolean
  action?: Action
  /** the context value its menus match: `board`, `agent`, `worktree` */
  context?: string
  /** the session connection of an agent node */
  agent?: string
  /** the path of a worktree node or of one of its boards */
  worktree?: string
  /** a finding's fingerprint and position, which find it again once a recompile gave it another id */
  finding?: { board: string; fingerprint: string; at: [number, number] }
}

const SEVERITIES = [
  { key: 'error', label: 'Errors', icon: 'error' },
  { key: 'warning', label: 'Warnings', icon: 'warning' },
  { key: 'info', label: 'Info', icon: 'info' },
] as const

const mm = (v: number) => String(Math.round(v * 100) / 100)

function request(src: Src, root: string): SelectRequest {
  return { file: path.resolve(root, src.file), line: src.line, col: src.col, endLine: src.endLine ?? src.line, endCol: src.endCol ?? src.col }
}

/** The finding's own range, else the narrowest range that drew one of its items. */
export function findingSource(site: Site, m: Marker, root: string): SelectRequest | undefined {
  const s = m.src?.[0]
  if (s) return { file: path.resolve(root, s.file), line: s.start[0], col: s.start[1], endLine: s.end[0], endCol: s.end[1] }
  const items = new Set(m.items ?? [])
  if (!items.size) return undefined
  let best: { file: string; r: { start: [number, number]; end: [number, number]; ids: number[] } } | undefined
  for (const [file, ranges] of Object.entries(site.sources ?? {}))
    for (const r of ranges) if (r.ids.some(id => items.has(id)) && (!best || r.ids.length < best.r.ids.length)) best = { file, r }
  if (!best) return undefined
  const { file, r } = best
  return { file: path.resolve(root, file), line: r.start[0], col: r.start[1], endLine: r.end[0], endCol: r.end[1] }
}

/** DRC and ERC findings of every board, grouped by severity, keyed by exact id, a child per ref; the board names the finding when there are several. */
export function findingNodes(sites: Site[], root: string): Node[] {
  const many = sites.length > 1
  return SEVERITIES.flatMap(({ key, label, icon }) => {
    const children = sites.flatMap(site =>
      (['drc', 'erc'] as const).flatMap(kind =>
        (site[kind] ?? []).flatMap((m): Node[] => {
          if (m.severity !== key || !m.id) return []
          const name = site.title || site.name
          const where = `${mm(m.at[0])}, ${mm(m.at[1])} mm${m.layer ? ` on ${m.layer}` : ''}`
          const id = `finding:${site.name}:${m.id}`
          const refs = m.refs ?? []
          return [
            {
              id,
              label: m.rule,
              description: many ? `${name} · ${m.message}` : m.message,
              tooltip: `${name} ${kind.toUpperCase()} ${m.severity} ${m.rule}\n${m.message}\n${where}${refs.length ? `\n${refs.join(', ')}` : ''}\n${m.id}`,
              icon,
              action: { kind: 'finding', board: site.name, id: m.id, source: findingSource(site, m, root) },
              ...(m.fingerprint ? { finding: { board: site.name, fingerprint: m.fingerprint, at: m.at } } : {}),
              ...(refs.length ? { children: refs.map(ref => refNode(site, ref, `${id}/${ref}`, root)), expanded: false } : {}),
            },
          ]
        }),
      ),
    )
    return children.length ? [{ id: `severity:${key}`, label, description: String(children.length), icon, children, expanded: key !== 'info' }] : []
  })
}

/** A reference as a row: a click selects it in the viewer, a part's opens its placement too. */
function refNode(site: Site, ref: string, id: string, root: string, description?: string): Node {
  const src = site.footprints.find(f => f.ref === ref.split('/')[0])?.src
  return {
    id,
    label: ref,
    ...(description ? { description } : {}),
    icon: ref.startsWith('net:') ? 'git-commit' : ref.includes(':') ? 'symbol-misc' : 'symbol-constant',
    action: { kind: 'ref', board: site.name, ref, ...(src && !ref.includes(':') ? { source: request(src, root) } : {}) },
  }
}

/** What the trees remember across a recompile: the open nodes and the selected one, by node id. */
export interface TreeState {
  expanded: string[]
  collapsed?: string[]
  selected?: string
}

const findingsOf = (nodes: Node[]): Node[] => nodes.flatMap(n => (n.finding ? [n] : findingsOf(n.children ?? [])))

/** The state carried onto new nodes: an id still there stays; a finding whose id changed is found by board and fingerprint, nearest its old position, and its open refs come with it. */
export function carryState(prev: Node[], next: Node[], state: TreeState): TreeState {
  const ids = new Set<string>()
  const walk = (ns: Node[]) => ns.forEach(n => (ids.add(n.id), walk(n.children ?? [])))
  walk(next)
  const old = findingsOf(prev)
  const fresh = findingsOf(next).filter(n => !old.some(o => o.id === n.id))
  const moved = new Map<string, string>()
  for (const o of old) {
    if (ids.has(o.id) || !o.finding) continue
    let best: Node | undefined,
      d = Infinity
    for (const n of fresh) {
      if (n.finding!.board !== o.finding.board || n.finding!.fingerprint !== o.finding.fingerprint || [...moved.values()].includes(n.id)) continue
      const e = Math.hypot(n.finding!.at[0] - o.finding.at[0], n.finding!.at[1] - o.finding.at[1])
      if (e < d) [best, d] = [n, e]
    }
    if (best) moved.set(o.id, best.id)
  }
  const map = (id: string): string | undefined => {
    if (ids.has(id)) return id
    for (const [from, to] of moved) {
      const c = id === from ? to : id.startsWith(`${from}/`) ? to + id.slice(from.length) : undefined
      if (c && ids.has(c)) return c
    }
    return undefined
  }
  const selected = state.selected !== undefined ? map(state.selected) : undefined
  const collapsed = state.collapsed?.flatMap(id => map(id) ?? [])
  return { expanded: state.expanded.flatMap(id => map(id) ?? []), ...(collapsed?.length ? { collapsed } : {}), ...(selected ? { selected } : {}) }
}

/** The nodes with `expanded` set from a carried state, for the ids the state names. */
export function withExpanded(nodes: Node[], expanded: readonly string[], collapsed: readonly string[] = []): Node[] {
  const open = new Set(expanded),
    closed = new Set(collapsed)
  return nodes.map(n => (n.children ? { ...n, expanded: !closed.has(n.id) && (!!n.expanded || open.has(n.id)), children: withExpanded(n.children, expanded, collapsed) } : n))
}

/** The parts of the board shown, by reference: an instance's parts under it as `CH2/R01`, the board's own by ref. */
export function partNodes(site: Site, root: string): Node[] {
  const parts: { ref: string; path?: string[]; local?: string }[] = site.schematic?.parts ?? site.footprints.map(f => ({ ref: f.ref }))
  const placed = new Set(site.footprints.map(f => f.ref))
  const key = (p: string[]) => p.join('/')
  const own = parts.filter(p => placed.has(p.ref) && !p.path?.length)
  const insts = (site.schematic?.circuits ?? []).map(c => {
    const kids = parts.filter(p => placed.has(p.ref) && p.path?.length && key(p.path) === key(c.path))
    return {
      id: `instance:${site.name}:${key(c.path)}`,
      label: key(c.path),
      description: [c.circuit, `${kids.length} part${kids.length === 1 ? '' : 's'}`].filter(Boolean).join(' · '),
      icon: 'symbol-namespace',
      action: { kind: 'ref', board: site.name, ref: key(c.path) } as Action,
      children: kids.map(p => refNode(site, `${key(p.path!)}/${p.local ?? p.ref}`, `part:${site.name}:${p.ref}`, root, p.ref)),
      expanded: false,
    }
  })
  return [...insts.filter(n => n.children.length), ...own.map(p => refNode(site, p.ref, `part:${site.name}:${p.ref}`, root))]
}

export function netNodes(site: Site): Node[] {
  const pads = new Map<string, number>()
  for (const f of site.footprints) for (const p of f.pads ?? []) if (p.net) pads.set(p.net, (pads.get(p.net) ?? 0) + 1)
  return site.nets.map(net => {
    const n = pads.get(net) ?? 0
    return {
      id: `net:${site.name}:${net}`,
      label: net,
      description: `${n} pad${n === 1 ? '' : 's'}`,
      icon: 'git-commit',
      action: { kind: 'net', board: site.name, net } as Action,
    }
  })
}

/** One row per BOM line; a click opens the placement of its first part. */
export function bomNodes(site: Site, root: string): Node[] {
  const placed = new Map(site.footprints.map(f => [f.ref, f.src]))
  return site.bom.map((row, i) => {
    const src = placed.get(row.refs[0])
    const fields = Object.entries(row.fields ?? {}).map(([k, v]) => `${k} ${v}`)
    return {
      id: `bom:${site.name}:${i}`,
      label: row.refs.join(', '),
      description: `${row.value} · ${row.qty}x`,
      tooltip: [`${row.refs.join(', ')}: ${row.value}`, row.footprint, ...fields].join('\n'),
      icon: 'symbol-constant',
      ...(src ? { action: { kind: 'source', board: site.name, source: request(src, root) } as Action } : {}),
    }
  })
}

/** `session/select` for a board row's click: the board's entry in the editor, the cursor on its `<PCB` and the editor focused. */
export const entryJump = (board: string, project?: string) => ({ board, refs: [`board:${board}`], focus: true, ...(project ? { project } : {}) })

/** A row's source jump keeps its session across asynchronous navigation and compile waits. */
export const entryJumper =
  (link: Pick<SessionLink, 'open' | 'request'> | undefined, project?: string) =>
  (board: string): Promise<unknown> =>
    link?.open ? link.request('session/select', entryJump(board, project)) : Promise.resolve()

export type BoardRow = { name: string; title?: string; entry?: string; status?: string; targets?: string[] }

export const boardRow = (b: BoardRow, shown: string | undefined, parts: Node[], route?: string, root?: string): Node => ({
  id: `board:${root ?? route ?? ''}:${b.name}`,
  label: b.title || b.name,
  description: [b.name === shown ? 'shown' : '', b.status && b.status !== 'ok' ? b.status : ''].filter(Boolean).join(', ') || undefined,
  tooltip: `${b.entry ?? ''}${b.targets?.length ? `\ntargets: ${b.targets.join(', ')}` : ''}`,
  icon: b.status === 'error' ? 'error' : 'circuit-board',
  action: { kind: 'board', name: b.name, ...(route ? { route } : {}), ...(root ? { project: root } : {}), ...(b.entry && root ? { entry: path.resolve(root, b.entry) } : {}) },
  ...(b.name === shown && parts.length ? { children: parts, expanded: false } : {}),
})

/** Config rows expand directly to boards; resolving them must not navigate any viewer. */
export function boardNodes(
  info: IdeBoardsMsg | undefined,
  scopes: ScopesMsg | undefined,
  shown: string | undefined,
  parts: Node[] = [],
  declared: Record<string, string[]> = {},
  configs: Record<string, string> = {},
  configLabel: (file: string) => string = file => path.basename(path.dirname(file)),
): Node[] {
  const roots = scopes?.scopes.length ? scopes.scopes : info ? [{ root: info.root ?? '', route: '/', displayed: true, boards: info.boards, status: 'ok' }] : []
  return roots.map(scope => {
    const on = scope.displayed
    const boards = on ? (info?.boards ?? scope.boards ?? []) : (scope.boards ?? [])
    const entries = [...new Set(declared[scope.root] ?? boards.flatMap(b => (b.entry ? [path.resolve(scope.root, b.entry)] : [])))]
    const config = configs[scope.root] ?? path.join(scope.root, 'pcb.config.ts')
    const row = (b: BoardRow) => boardRow(b, on ? shown : undefined, on && b.name === shown ? parts : [], scope.route, scope.root)
    const children = boards.filter(b => b.entry && entries.includes(path.resolve(scope.root, b.entry))).map(row)
    return {
      id: `config:${config}`,
      label: configLabel(config),
      tooltip: config,
      description: on ? 'shown' : scope.status,
      icon: 'settings-gear',
      children,
      ...(entries.length ? { load: { root: scope.root, entries, route: scope.route } } : {}),
      expanded: !!on,
    }
  })
}

/** Legacy scope actions only expand, even for a single entry. */
export async function openFolder(a: Extract<Action, { kind: 'scope' }>, p: { expand(id: string): Promise<void> }): Promise<void> {
  await p.expand(a.id)
}

/** Resolve the captured action owner; an explicit project never falls back to another connection. */
export function actionOwner<L extends { session: string; open: boolean; roots: readonly string[] }>(a: Action, links: readonly L[], fallback?: L): L | undefined {
  const link = a.session ? links.find(l => l.session === a.session && l.open) : fallback
  if (!link?.open || (a.project && !link.roots.some(root => path.resolve(root) === path.resolve(a.project!)))) return undefined
  return link
}

/** A project-bound entity action navigates its scope before selecting, even within one session. */
export function actionPage(project: string, board: string | undefined, link: Pick<SessionLink, 'root' | 'scopes'>): string | undefined {
  const scope = link.scopes?.scopes.find(s => path.resolve(s.root) === path.resolve(project))
  const route = scope?.route ?? (link.root && path.resolve(link.root) === path.resolve(project) ? '/' : undefined)
  return route === undefined ? undefined : board ? boardPath(route, board) : route
}
