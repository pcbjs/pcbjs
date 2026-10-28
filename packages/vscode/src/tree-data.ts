// The sidebar's trees without vscode: Boards from `pcbjs:ide:boards` and `pcbjs:ide:scopes`, Findings, Nets and BOM from
// each board's site data, `/__pcbjs/<board>/board.json` of the scope the server shows.

import * as path from 'node:path'
import type { BoardsInfo, ScopesInfo, SelectRequest } from './protocol'

interface Src {
  file: string
  line: number
  col: number
  endLine?: number
  endCol?: number
  abs?: string
}

export interface Marker {
  severity: 'error' | 'warning' | 'info'
  rule: string
  message: string
  at: [number, number]
  layer?: string
  items?: number[]
  src?: Src
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
}

export type Action =
  | { kind: 'finding'; board: string; at: [number, number]; layer: string | null; source?: SelectRequest }
  | { kind: 'net'; board: string; net: string }
  | { kind: 'source'; source: SelectRequest }
  | { kind: 'board'; name: string }
  | { kind: 'scope'; route: string }

export interface Node {
  id: string
  label: string
  description?: string
  tooltip?: string
  /** a codicon id */
  icon?: string
  children?: Node[]
  expanded?: boolean
  action?: Action
}

const SEVERITIES = [
  { key: 'error', label: 'Errors', icon: 'error' },
  { key: 'warning', label: 'Warnings', icon: 'warning' },
  { key: 'info', label: 'Info', icon: 'info' },
] as const

const mm = (v: number) => String(Math.round(v * 100) / 100)

function request(src: Src, root: string): SelectRequest {
  return { file: src.abs ?? path.resolve(root, src.file), line: src.line, col: src.col, endLine: src.endLine ?? src.line, endCol: src.endCol ?? src.col }
}

/** The finding's own range, else the narrowest range that drew one of its items. */
export function findingSource(site: Site, m: Marker, root: string): SelectRequest | undefined {
  if (m.src) return request(m.src, root)
  const items = new Set(m.items ?? [])
  if (!items.size) return undefined
  let best: { file: string; r: { start: [number, number]; end: [number, number]; ids: number[] } } | undefined
  for (const [file, ranges] of Object.entries(site.sources ?? {}))
    for (const r of ranges) if (r.ids.some(id => items.has(id)) && (!best || r.ids.length < best.r.ids.length)) best = { file, r }
  if (!best) return undefined
  const { file, r } = best
  return { file: path.resolve(root, file), line: r.start[0], col: r.start[1], endLine: r.end[0], endCol: r.end[1] }
}

/** DRC and ERC findings of every board, grouped by severity; the board names the finding when there are several. */
export function findingNodes(sites: Site[], root: string): Node[] {
  const many = sites.length > 1
  return SEVERITIES.flatMap(({ key, label, icon }) => {
    const children = sites.flatMap(site =>
      (['drc', 'erc'] as const).flatMap(kind =>
        (site[kind] ?? []).flatMap((m, i): Node[] => {
          if (m.severity !== key) return []
          const name = site.title || site.name
          const where = `${mm(m.at[0])}, ${mm(m.at[1])} mm${m.layer ? ` on ${m.layer}` : ''}`
          return [
            {
              id: `finding:${site.name}:${kind}:${i}`,
              label: m.rule,
              description: many ? `${name} · ${m.message}` : m.message,
              tooltip: `${name} ${kind.toUpperCase()} ${m.severity} ${m.rule}\n${m.message}\n${where}`,
              icon,
              action: { kind: 'finding', board: site.name, at: m.at, layer: m.layer ?? null, source: findingSource(site, m, root) },
            },
          ]
        }),
      ),
    )
    return children.length ? [{ id: `severity:${key}`, label, description: String(children.length), icon, children, expanded: key !== 'info' }] : []
  })
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
      ...(src ? { action: { kind: 'source', source: request(src, root) } as Action } : {}),
    }
  })
}

/** The boards of the scope shown, under their scope when the server serves several. */
export function boardNodes(info: BoardsInfo | undefined, scopes: ScopesInfo | undefined, shown: string | undefined): Node[] {
  const boards: Node[] = (info?.boards ?? []).map(b => ({
    id: `board:${b.name}`,
    label: b.title || b.name,
    description: [b.name === shown ? 'shown' : '', b.status && b.status !== 'ok' ? b.status : ''].filter(Boolean).join(', ') || undefined,
    tooltip: `${b.entry}${b.targets?.length ? `\ntargets: ${b.targets.join(', ')}` : ''}`,
    icon: b.status === 'error' ? 'error' : 'circuit-board',
    action: { kind: 'board', name: b.name },
  }))
  const list = scopes?.scopes ?? []
  if (scopes?.single !== false || list.length < 2) return boards
  return list.map(s => {
    const on = s.displayed ?? s.slug === scopes.displayed
    return {
      id: `scope:${s.slug ?? s.root}`,
      label: s.name ?? path.basename(s.root),
      description: on ? 'shown' : s.status,
      tooltip: s.root,
      icon: 'folder',
      children: on ? boards : undefined,
      expanded: on,
      ...(s.route ? { action: { kind: 'scope', route: s.route } as Action } : {}),
    }
  })
}
