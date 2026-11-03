// The hover: its image, the literal under the cursor, what the code drew, its routes and findings, the routes a helper call made, the pin table and the docs.

import type { Hover } from 'vscode-languageserver/node.js'
import type { RouteInfo } from '@pcbjs/core/site-data'
import type { Position, Range } from '@pcbjs/core/protocol'
import { toSite } from '@pcbjs/core/internal/textdoc'
import type { DocModel } from './doc.js'
import type { Hit } from './detect.js'
import type { Target } from './target.js'
import { before, itemsOf, lspRange, type FileFacts, type RangeHit } from './facts.js'
import { drew, netLabel, routesText } from './format.js'
import { summary } from './describe.js'
import { hoverPreview, imageMarkdown, pinTable, targetPreview, type HoverPreview } from './hover-preview.js'
import { renderPreview } from './preview.js'
import { innermost } from './segments.js'
import { docsExcerpt, excerptMarkdown } from './docs.js'
import { elementAround } from './units.js'

export interface HoverInput {
  file: string
  /** the open document, absent for a file the connection does not hold */
  doc?: DocModel
  position: Position
  facts: FileFacts
  /** what the token under the cursor names on the boards */
  target?: Target
}

export interface HoverResult {
  hover: Hover | null
  /** the grid a hovered `at` is written in, for the previews to light */
  grid?: { project: string; board: string; grid: string }
}

export function hover({ file, doc, position, facts: f, target }: HoverInput): HoverResult {
  const parts: string[] = []
  let hitRange: Range | undefined
  let hit: Hit | undefined
  let grid: HoverResult['grid']
  if (doc) {
    hit = innermost(doc.hits(), doc.offset(position))
    if (hit) {
      hitRange = doc.range(hit)
      if (hit.kind === 'at') grid = gridOf(f, doc, hit.start)
      parts.push(`**pcbjs ${hit.kind}** of \`${hit.context.owner}\` \`${hit.context.prop}\`${hit.context.chain ? ', a builder method' : ''}: ${summary(hit)}${pinNet(hit, f)}`)
    }
  }
  const at = f.rangeAt(position)
  if (at) parts.push(drew(at.ref.site, at.range, f.boards.length > 1 ? f.boards.map(b => b.ref.site) : undefined))
  let routes = at ? routesAround(f, at, position, parts) : []
  if (!routes.length && doc) {
    const made = f.routesOfCall(doc, doc.offset(position))
    if (made.length) parts.push(`made by this call: ${routesText(made)}`)
    routes = made
  }
  // a model path keeps its own image: the target around it is only the part it belongs to
  const own = previewOf(f, file, doc, position, hit, at, routes)
  const image = own?.kind === 'model' ? own : ((target && targetPreview(target, f.all)) ?? own)
  if (target && doc && own?.kind !== 'model') hitRange = doc.range(target)
  if (image) parts.unshift(imageMarkdown(image, `${image.kind} on ${image.board}`), ...image.lines, ...(image.note ? [`_${image.note}_`] : []))
  const pins = pinsOf(target, image, f)
  if (pins) parts.push(pins)
  // the docs go last, below the preview and what the code drew
  const excerpt = doc && docsExcerpt(doc.sf(), doc.offset(position))
  if (excerpt) parts.push(excerptMarkdown(excerpt))
  if (!parts.length) return { hover: null, grid }
  const range = hitRange ?? (at ? lspRange(at.range) : undefined)
  return { hover: { contents: { kind: 'markdown', value: parts.join('\n\n') }, ...(range ? { range } : {}) }, grid }
}

/** The routes and findings of the ranges around the cursor, innermost first: a layout placed several times made one route per instance at the same call. */
function routesAround(f: FileFacts, at: RangeHit, position: Position, parts: string[]): RouteInfo[] {
  const { line, col } = toSite(position)
  const around = at.ranges.filter(r => !before([line, col], r.start) && !before(r.end, [line, col - 1])).sort((a, b) => (before(a.start, b.start) ? 1 : -1))
  const routes = around.map(r => f.routesAt(r.start)).find(x => x.length) ?? []
  const found = around.map(r => f.findingsAt(r.start)).find(x => x.length) ?? []
  if (routes.length) parts.push(routesText(routes))
  if (found.length) parts.push(found.map(m => `- ${m.severity} ${m.rule}: ${m.message}`).join('\n'))
  return routes
}

function pinNet(hit: Hit, f: FileFacts): string {
  if (hit.kind !== 'pinRef') return ''
  const n = f.padNets(hit.context.ref ?? '', hit.value)
  return n === undefined ? '' : `, ${netLabel(n)}`
}

/** The pin table of the part a hover names, by its handle or its placement. */
function pinsOf(target: Target | undefined, image: HoverPreview | undefined, f: FileFacts): string | null {
  const bt = target?.kind === 'part' ? target.boards[0] : undefined
  const ref = bt?.parts[0] ?? (image?.kind === 'placement' || image?.kind === 'footprint' ? image.refs?.[0] : undefined)
  const site = f.all.find(b => b.site.name === (bt?.board ?? image?.board))?.site
  return ref && site ? pinTable(site, ref) : null
}

/** A hovered `at` in grid units lights its grid in the previews, since editors tell no server when a hint is hovered. */
function gridOf(f: FileFacts, doc: DocModel, start: number): HoverResult['grid'] {
  const at = elementAround(doc.sf(), start)
  const g = at && f.gridAt(at.line, at.col)
  return g ? { project: g.project, board: g.board, grid: g.grid.name } : undefined
}

/** The hover's image: the item under the cursor, else the routes a helper call made there. */
function previewOf(
  f: FileFacts,
  file: string,
  doc: DocModel | undefined,
  pos: Position,
  hit: Hit | undefined,
  at: RangeHit | undefined,
  routes: RouteInfo[],
): HoverPreview | undefined {
  try {
    const got = hoverPreview({ file, doc, offset: doc?.offset(pos), hit, at: at && { ref: at.ref, range: at.range }, boards: f.all, parts: n => f.parts(n) })
    return got ?? routesPreview(f, routes)
  } catch {
    return undefined
  }
}

/** The items of the routes a helper call made: the range of a route call in a helper holds every call's items, so those of the routes' nets and pairs. */
function routesPreview(f: FileFacts, routes: RouteInfo[]): HoverPreview | undefined {
  if (!routes.length) return undefined
  const nets = new Set(routes.map(r => r.net)),
    pairs = new Set(routes.flatMap(r => (r.pair ? [r.pair] : [])))
  for (const b of f.all) {
    const items = itemsOf(b.site)
    const ids = routes
      .flatMap(r => (r.src ? (b.site.sources?.[r.src.file]?.find(x => x.start[0] === r.src!.line && x.start[1] === r.src!.col)?.uids ?? []) : []))
      .filter(i => {
        const it = items.get(i)
        return !!it && ((it.net !== undefined && nets.has(it.net)) || (it.pair !== undefined && pairs.has(it.pair)))
      })
    const preview = ids.length ? renderPreview(b.site, { ids: ids.map(u => items.get(u)!.id) }) : undefined
    if (preview) return { kind: 'items', preview, board: b.site.name, lines: [] }
  }
  return undefined
}
