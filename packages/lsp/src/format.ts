// The text the hovers and lenses show: routes with their lengths and targets, instances, findings and what a source range drew.

import type { RouteInfo, SiteData, SourceRange } from '@pcbjs/core/site-data'
import { formatNum } from '@pcbjs/core/internal/units'
import { itemsOf, partPaths } from './facts.js'

type Paths = Map<string, { path: string; local: string }>

const mm = (v: number) => `${formatNum(v, 3)} mm`

const partText = (ref: string, paths: Paths) => {
  const p = paths.get(ref)
  return p ? `${ref} (${p.path}/${p.local})` : ref
}

/** The parts of one source range placed by a layout several times, by instance path. */
export function instancesText(refs: string[], paths: Paths): string {
  const sorted = [...refs].sort((a, b) => (paths.get(a)?.path ?? '').localeCompare(paths.get(b)?.path ?? '', undefined, { numeric: true }))
  return `${refs.length} instances: ${sorted
    .slice(0, 8)
    .map(r => partText(r, paths))
    .join(' · ')}${refs.length > 8 ? ' · ...' : ''}`
}

export const netLabel = (nets: (string | null)[]): string => {
  const u = [...new Set(nets.map(n => n ?? 'no net'))]
  return u.length === 1 ? (u[0] === 'no net' ? 'no net' : `net ${u[0]}`) : `nets ${u.join(', ')}`
}

const met = (r: RouteInfo) => r.target && r.length >= r.target.min - 1e-6 && r.length <= r.target.max + 1e-6

function routeText(r: RouteInfo): string {
  const parts = [`${r.pair ? 'pair' : 'route'} ${r.net}: **${mm(r.length)}**`]
  if (r.target) {
    const t = r.target
    parts.push(`target ${t.max >= 1e6 ? `at least ${mm(t.min)}` : `${formatNum(t.min, 3)} to ${mm(t.max)}`}${met(r) ? ', met' : r.length < t.min ? ', short' : ', long'}`)
  }
  if (r.group !== undefined) parts.push(`group ${r.group}`)
  if (r.skew !== undefined) parts.push(`skew ${mm(r.skew)}`)
  return parts.join(' · ')
}

/** The instance of a route made by a layout placed several times, unless its net already names it, as `A/sl` does. */
const inst = (r: RouteInfo) => (r.path && !r.net.startsWith(`${r.path}/`) ? `${r.path}: ` : '')

/** Several routes of one call for a hover: one line each, with the instance path of a layout placed several times. */
export function routesText(rs: RouteInfo[]): string {
  if (rs.length === 1) return `${inst(rs[0])}${routeText(rs[0])}`
  const shown = rs.slice(0, 16).map(r => `- ${inst(r)}${routeText(r)}`)
  return [`${rs.length} routes`, ...shown, ...(rs.length > 16 ? [`- and ${rs.length - 16} more`] : [])].join('\n')
}

/** The lens of a route call or of a helper's call site: the one route, or every route it made with its instance and length. */
export function routesTitle(rs: RouteInfo[]): string {
  if (rs.length === 1) return `${inst(rs[0])}${routeText(rs[0]).replace(/\*\*/g, '')}`
  const one = (r: RouteInfo) => `${inst(r)}${r.net} ${mm(r.length)}${r.target ? (met(r) ? ' met' : r.length < r.target.min ? ' short' : ' long') : ''}`
  return `${rs.length} ${rs.every(r => r.pair) ? 'pairs' : 'routes'}: ${rs.slice(0, 6).map(one).join(' · ')}${rs.length > 6 ? ` · and ${rs.length - 6} more` : ''}`
}

export function findingsTitle(ms: { severity: string; rule: string }[]): string {
  const count = (sev: string) => ms.filter(m => m.severity === sev).length
  const e = count('error'),
    w = count('warning')
  const rules = [...new Set(ms.map(m => m.rule))].join(', ')
  return [e ? `${e} error${e === 1 ? '' : 's'}` : '', w ? `${w} warning${w === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ') + `: ${rules}`
}

const KINDS = ['track', 'via', 'pad', 'zone', 'graphic', 'text']
/** What a source range drew: item counts by kind, nets, parts, and the command of a path. */
export function drew(site: SiteData, r: SourceRange, others?: SiteData[]): string {
  const items = itemsOf(site)
  const kinds = new Map<string, number>()
  const nets = new Set<string>()
  for (const id of r.uids) {
    const it = items.get(id)
    if (!it) continue
    kinds.set(it.kind, (kinds.get(it.kind) ?? 0) + 1)
    if (it.net) nets.add(it.net)
  }
  const list = [...kinds].sort((a, b) => KINDS.indexOf(a[0]) - KINDS.indexOf(b[0])).map(([k, n]) => `${n} ${k}${n === 1 ? '' : 's'}`)
  const parts = [
    `Drew ${list.length ? list.join(', ') : `${r.uids.length} items`} on ${site.title || site.name}${others && others.length > 1 ? ` and ${others.length - 1} more board${others.length > 2 ? 's' : ''}` : ''}`,
  ]
  const paths = partPaths(site)
  if (r.refs.length)
    parts.push(
      `part${r.refs.length === 1 ? '' : 's'} ${r.refs
        .slice(0, 8)
        .map(x => partText(x, paths))
        .join(', ')}${r.refs.length > 8 ? ', ...' : ''}`,
    )
  if (nets.size) parts.push(`net${nets.size === 1 ? '' : 's'} ${[...nets].slice(0, 6).join(', ')}${nets.size > 6 ? ', ...' : ''}`)
  if (r.seg) parts.push(`command \`${r.seg}\``)
  return parts.join(' · ')
}
