// docs/editor.md describes what each hover shows.

import { readFileSync, statSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import ts from 'typescript'
import type { SiteData, SiteFootprint, SourceRange } from '@pcbjs/core/site-data'
import type { Hit } from './detect.js'
import type { Target } from './target.js'
import { padItems, renderPreview, type Preview, type PreviewSpec } from './preview.js'
import { schPreview } from './sch-preview.js'
import { formatNum } from './values.js'

export interface PreviewBoard {
  root: string
  site: SiteData
}

export interface PreviewContext {
  /** the file, absolute */
  file: string
  text?: string
  offset?: number
  /** the literal under the cursor */
  hit?: Hit
  /** the innermost source range under the cursor and the board it is on */
  at?: { ref: PreviewBoard; range: SourceRange }
  /** the boards that know the file */
  boards: PreviewBoard[]
  /** the footprints a part name may mean */
  parts(name: string): { fp: SiteFootprint; site: SiteData }[]
}

export interface HoverPreview {
  kind: 'pad' | 'model' | 'keepout' | 'net' | 'footprint' | 'placement' | 'items' | 'group' | 'point' | 'reference' | 'schematic'
  preview: Preview
  /** the board the preview is of */
  board: string
  /** markdown lines to show below the image */
  lines: string[]
  /** a note on what the preview leaves out, such as the 3D model */
  note?: string
}

/** The image of a hover, or undefined when nothing under the cursor has one. */
export function hoverPreview(ctx: PreviewContext): HoverPreview | undefined {
  const sf = ctx.text !== undefined ? parse(ctx.file, ctx.text) : undefined
  const node = sf && ctx.offset !== undefined ? nodeAt(sf, ctx.offset) : undefined
  return (
    padPreview(ctx) ??
    (node && (modelPreview(ctx, node) ?? keepoutPreview(ctx, node) ?? netPreview(ctx, node) ?? factoryPreview(ctx, node))) ??
    schematicPreview(ctx) ??
    rangePreview(ctx) ??
    (node && callPreview(ctx, node))
  )
}

/** The markdown of an image, first in a hover. */
export function imageMarkdown(p: HoverPreview, alt: string): string {
  return `![${alt.replace(/[[\]\\]/g, '')}](${p.preview.uri})`
}

/** A pad: `J1[3]`, `'U1.3'`, `U1.pad('6')`. */
function padPreview(ctx: PreviewContext): HoverPreview | undefined {
  const hit = ctx.hit
  if (hit?.kind !== 'pinRef') return undefined
  const ref = hit.context.ref ?? ''
  const num = hit.context.form === 'dotted' ? hit.value.slice(ref.length + 1) : hit.value
  for (const { fp, site } of ctx.parts(ref)) {
    const pads = padItems(site, fp.ref)
    const pad = pads.find(p => p.num === num) ?? pads.find(p => p.name === num)
    if (!pad) continue
    const preview = renderPreview(site, { ids: [pad.item.id], labels: [{ at: pad.at, text: pad.num || pad.name }] })
    if (!preview) continue
    return {
      kind: 'pad',
      preview,
      board: site.name,
      lines: [
        `pad **${fp.ref}.${pad.num}**${pad.name && pad.name !== pad.num ? ` ${pad.name}` : ''} · ${pad.item.net ? `net ${pad.item.net}` : 'no net'} · at ${xy(pad.at)} · ${pad.item.layers.length > 1 ? 'through hole' : (pad.item.layers[0] ?? 'no copper')}`,
      ],
    }
  }
  return undefined
}

/** What a symbol resolved to: a part, a pad, a net, a group, a point, a reference. */
export function targetPreview(t: Target, boards: PreviewBoard[]): HoverPreview | undefined {
  for (const bt of t.boards) {
    const site = boards.find(b => b.site.name === bt.board)?.site
    if (!site) continue
    const got = targetImage(t, bt, site)
    if (got) return got
  }
  return undefined
}

function targetImage(t: Target, bt: Target['boards'][number], site: SiteData): HoverPreview | undefined {
  const at = (preview: Preview | undefined, kind: HoverPreview['kind'], lines: string[]) => (preview ? { kind, preview, board: site.name, lines } : undefined)
  switch (t.kind) {
    case 'part': {
      const fp = site.footprints.find(f => f.ref === bt.refs[0])!
      const sp = site.schematic.parts.find(p => p.ref === fp.ref)
      const named = fp.pads.filter(p => p.num).length
      const lines = [
        `land pattern **${sp?.footprint ?? fp.id}** · ${named} pad${named === 1 ? '' : 's'} · ${formatNum(fp.body.w, 2)} x ${formatNum(fp.body.h, 2)} mm body · placed as ${refsText(bt.refs)}`,
      ]
      lines.push(...bt.refs.slice(0, 3).map(r => placementText(site, r)))
      if (bt.refs.length > 3) lines.push(`and ${bt.refs.length - 3} more parts`)
      return at(renderPreview(site, { frame: fp.ref }), 'footprint', lines)
    }
    case 'pad': {
      const items = new Map((site.items ?? []).map(i => [i.id, i]))
      const ref = site.footprints.find(f => f.ref === items.get(bt.ids[0])?.ref)?.ref
      const pads = ref ? padItems(site, ref).filter(p => bt.ids.includes(p.item.id)) : []
      if (!ref || !pads.length) return undefined
      const lines = pads
        .slice(0, 4)
        .map(
          p =>
            `pad **${ref}.${p.num}**${p.name && p.name !== p.num ? ` ${p.name}` : ''} · ${p.item.net ? `net ${p.item.net}` : 'no net'} · at ${xy(p.at)} · ${p.item.layers.length > 1 ? 'through hole' : (p.item.layers[0] ?? 'no copper')}`,
        )
      if (bt.ids.length > pads.length) lines.push(`and the same pad of ${bt.name.split(', ').length - pads.length} more parts`)
      return at(renderPreview(site, { frame: ref, pads: pads.map(p => p.num) }), 'pad', lines)
    }
    case 'net':
      return netImage(site, bt.name.split(', ')[0])
    case 'group':
      return at(renderPreview(site, { refs: bt.refs }), 'group', [`instance **${bt.name}** · ${refsText(bt.refs)}`])
    case 'point':
      return at(renderPreview(site, { points: bt.points }), 'point', [`point ${bt.points!.map(xy).join(' · ')}`])
    case 'reference': {
      const r = (site.references ?? []).find(x => x.name === bt.reference)
      return r?.outline && at(renderPreview(site, { outlines: [r.outline] }), 'reference', [`reference **${r.title || r.name}** · ${r.anchor}`])
    }
  }
}

/** A model path: `model: { file: './models/X.step' }`. */
function modelPreview(ctx: PreviewContext, node: ts.Node): HoverPreview | undefined {
  if (!ts.isStringLiteralLike(node)) return undefined
  const p = node.parent
  const inModel = (n: ts.Node | undefined): boolean => {
    for (let k = 0; n && k < 4; k++, n = n.parent) {
      if ((ts.isPropertyAssignment(n) || ts.isJsxAttribute(n)) && nameOf(n.name) === 'model') return true
    }
    return false
  }
  if (!((ts.isPropertyAssignment(p) && nameOf(p.name) === 'file' && inModel(p.parent)) || inModel(p))) return undefined
  const abs = resolve(dirname(ctx.file), node.text)
  for (const b of ctx.boards) {
    const rel = relative(b.root, abs).split(sep).join('/')
    const fps = b.site.footprints.filter(f => f.step && (f.step.file === rel || resolve(b.root, f.step.file) === abs))
    if (!fps.length) continue
    const fp = fps[0],
      step = fp.step!
    const preview = renderPreview(b.site, { frame: fp.ref })
    if (!preview) continue
    const size = step.bounds ? step.bounds.max.map((v, i) => formatNum(v - step.bounds!.min[i], 2)).join(' x ') + ' mm' : undefined
    const lines = [
      `model \`${step.file}\` on ${refsText(fps.map(f => f.ref))} · ${step.mesh ? 'mesh ready' : 'file missing'}${size ? ` · ${size}` : ''}`,
      ...(step.issue ? [`model issue: ${step.issue}`] : []),
    ]
    return { kind: 'model', preview, board: b.site.name, lines, note: 'the land pattern it sits on; the 3D model itself is not drawn in a hover, open the 3D view' }
  }
  return undefined
}

function keepoutPreview(ctx: PreviewContext, node: ts.Node): HoverPreview | undefined {
  for (let n: ts.Node | undefined = node; n; n = n.parent) {
    const isCall = ts.isCallExpression(n) && calleeText(n.expression) === 'keepout'
    const isJsx = (ts.isJsxSelfClosingElement(n) || ts.isJsxElement(n)) && tagOf(n) === 'keepout'
    if (!isCall && !isJsx) continue
    const sf = n.getSourceFile()
    const s = sf.getLineAndCharacterOfPosition(n.getStart(sf)),
      e = sf.getLineAndCharacterOfPosition(n.getEnd())
    for (const b of ctx.boards) {
      const rel = relKey(b.root, ctx.file)
      const ks = (b.site.keepouts ?? []).filter(
        k => k.src && (k.src.file === rel || resolve(b.root, k.src.file) === ctx.file) && within([k.src.line - 1, k.src.col - 1], [s.line, s.character], [e.line, e.character]),
      )
      if (!ks.length) continue
      const preview = renderPreview(b.site, { keepouts: ks.map(k => k.outline) })
      if (!preview) continue
      const k = ks[0]
      const what = [k.tracks && 'tracks', k.vias && 'vias', k.pours && 'pours'].filter(Boolean).join(', ') || 'nothing'
      return {
        kind: 'keepout',
        preview,
        board: b.site.name,
        lines: [`keepout${ks.length > 1 ? ` x${ks.length}` : ''} on ${k.layers.join(', ')} · keeps out ${what}${k.ref ? ` · of ${k.ref}` : ''}`],
      }
    }
    return undefined
  }
  return undefined
}

/** A net name: `GND`, `UP.DP` for the net UP/DP. */
function netPreview(ctx: PreviewContext, node: ts.Node): HoverPreview | undefined {
  if (!ts.isIdentifier(node) && !ts.isStringLiteralLike(node)) return undefined
  let e: ts.Node = node
  if (ts.isIdentifier(node) && ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) e = node.parent
  // the declaration of a part, a call or a JSX tag is not a net
  if (ts.isIdentifier(node) && ts.isCallExpression(e.parent) && e.parent.expression === e) return undefined
  const names = ts.isStringLiteralLike(node) ? [node.text] : candidates(e)
  if (!names.length) return undefined
  const boards = ctx.at ? [ctx.at.ref, ...ctx.boards.filter(b => b !== ctx.at!.ref)] : ctx.boards
  for (const b of boards) {
    const name = names.find(n => b.site.nets.includes(n))
    const got = name ? netImage(b.site, name) : undefined
    if (got) return got
  }
  return undefined
}

function netImage(site: SiteData, name: string): HoverPreview | undefined {
  const labels: { at: [number, number]; text: string }[] = []
  let pads = 0
  for (const fp of site.footprints)
    for (const p of fp.pads)
      if (p.net === name) {
        pads++
        labels.push({ at: p.at, text: `${fp.ref}.${p.num}` })
      }
  const preview = renderPreview(site, { net: name, labels: labels.length <= 24 ? labels : [] })
  if (!preview) return undefined
  const count = (k: string) => (site.items ?? []).filter(i => i.net === name && i.kind === k).length
  const tracks = count('track'),
    vias = count('via'),
    zones = count('zone')
  const cls = site.schematic.nets.find(n => n.name === name)?.class
  const parts = [
    `net **${name}**${cls ? ` · class ${cls}` : ''}`,
    `${pads} pad${pads === 1 ? '' : 's'}`,
    `${tracks} track${tracks === 1 ? '' : 's'}`,
    `${vias} via${vias === 1 ? '' : 's'}`,
  ]
  if (zones) parts.push(`${zones} pour${zones === 1 ? '' : 's'}`)
  const lines = [parts.join(' · ')]
  if (labels.length && labels.length <= 24) lines.push(labels.map(l => l.text).join(', '))
  else if (labels.length)
    lines.push(
      `${labels
        .slice(0, 24)
        .map(l => l.text)
        .join(', ')}, and ${labels.length - 24} more; pads are named in the image up to 24`,
    )
  return { kind: 'net', preview, board: site.name, lines }
}

/** A footprint factory call: `R0603('10k')`, `kicadFootprint('Lib:Name')`, `const HUB = QFN(64, ...)`. */
function factoryPreview(ctx: PreviewContext, node: ts.Node): HoverPreview | undefined {
  const sf = node.getSourceFile()
  for (let n: ts.Node | undefined = node; n; n = n.parent) {
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isArrowFunction(n) || ts.isFunctionDeclaration(n) || ts.isSourceFile(n)) return undefined
    if (!ts.isCallExpression(n)) continue
    const start = sf.getLineAndCharacterOfPosition(n.getStart(sf))
    const decl = ts.isVariableDeclaration(n.parent) && ts.isIdentifier(n.parent.name) ? n.parent.name.text : undefined
    for (const b of ctx.boards) {
      const rel = relKey(b.root, ctx.file)
      // the parts this call made: their declaration is the call, or a call of the factory it was assigned to
      const made = b.site.schematic.parts.filter(
        p => p.src && (p.src.file === rel || resolve(b.root, p.src.file) === ctx.file) && p.src.line === start.line + 1 && p.src.col === start.character + 1,
      )
      const viaName =
        !made.length && decl ? b.site.schematic.parts.filter(p => p.src && textAt(resolve(b.root, p.src.file), p.src.line, p.src.col, ctx).startsWith(`${decl}(`)) : []
      const parts = (made.length ? made : viaName).filter(p => b.site.footprints.some(f => f.ref === p.ref))
      if (!parts.length) continue
      const fp = b.site.footprints.find(f => f.ref === parts[0].ref)!
      const preview = renderPreview(b.site, { frame: fp.ref })
      if (!preview) continue
      const sp = b.site.schematic.parts.find(p => p.ref === fp.ref)
      const named = fp.pads.filter(p => p.num).length
      return {
        kind: 'footprint',
        preview,
        board: b.site.name,
        lines: [
          `land pattern **${sp?.footprint ?? fp.id}** · ${named} pad${named === 1 ? '' : 's'} · ${formatNum(fp.body.w, 2)} x ${formatNum(fp.body.h, 2)} mm body · placed as ${refsText(parts.map(p => p.ref))}`,
        ],
      }
    }
  }
  return undefined
}

/** What a symbol placement, <Label>, <Power>, <Sheet> or wire() chain drew. */
function schematicPreview(ctx: PreviewContext): HoverPreview | undefined {
  if (ctx.text === undefined || ctx.offset === undefined) return undefined
  const before = ctx.text.slice(0, ctx.offset).split('\n')
  // the middle of the character under the mouse, so its first and last characters both count
  const line = before.length,
    col = before[before.length - 1].length + 1.5
  for (const b of ctx.boards) {
    const got = schPreview(b.site, b.root, ctx.file, line, col)
    if (got) return { kind: 'schematic', preview: got.preview, board: b.site.name, lines: got.lines }
  }
  return undefined
}

function rangePreview(ctx: PreviewContext): HoverPreview | undefined {
  const at = ctx.at
  if (!at || (!at.range.ids.length && !at.range.refs.length)) return undefined
  const site = at.ref.site
  const refs = at.range.refs.filter(r => site.footprints.some(f => f.ref === r))
  if (refs.length) {
    const own = new Set(refs)
    const items = new Map((site.items ?? []).map(i => [i.id, i]))
    const ids = at.range.ids.filter(i => {
      const it = items.get(i)
      return it && !(it.ref && own.has(it.ref))
    })
    const preview = renderPreview(site, { refs, ids })
    if (!preview) return undefined
    const lines = refs.slice(0, 3).map(r => placementText(site, r))
    if (refs.length > 3) lines.push(`and ${refs.length - 3} more parts`)
    return { kind: 'placement', preview, board: site.name, lines }
  }
  const preview = renderPreview(site, { ids: at.range.ids })
  return preview && { kind: 'items', preview, board: site.name, lines: [] }
}

/** A builder chain whose later calls have no range of their own, `route(a).V(33).X(b)`: the range of the call it starts with. */
function callPreview(ctx: PreviewContext, node: ts.Node): HoverPreview | undefined {
  const sf = node.getSourceFile()
  for (let n: ts.Node | undefined = node; n && !ts.isSourceFile(n); n = n.parent) {
    if (!ts.isCallExpression(n)) continue
    const s = sf.getLineAndCharacterOfPosition(n.getStart(sf))
    for (const b of ctx.boards) {
      const range = b.site.sources?.[relKey(b.root, ctx.file)]?.find(r => r.start[0] === s.line + 1 && r.start[1] === s.character + 1 && (r.ids.length || r.refs.length))
      if (range) return rangePreview({ ...ctx, at: { ref: b, range } })
    }
  }
  return undefined
}

/** One placed part: ref, value, footprint, position, rotation and side. */
function placementText(site: SiteData, ref: string): string {
  const fp = site.footprints.find(f => f.ref === ref)!
  const sp = site.schematic.parts.find(p => p.ref === ref)
  return `**${ref}** ${fp.value} · ${sp?.footprint ?? fp.id} · at ${xy(fp.at)}${fp.rot ? `, ${formatNum(fp.rot, 2)}°` : ''} · ${fp.side === 'B' ? 'back' : 'front'}${fp.dnp ? ' · not populated' : ''}`
}

const xy = (p: [number, number]) => `${formatNum(p[0], 3)}, ${formatNum(p[1], 3)} mm`
const refsText = (refs: string[]) => `${refs.slice(0, 6).join(', ')}${refs.length > 6 ? ` and ${refs.length - 6} more` : ''}`

const parsed = new Map<string, { text: string; sf: ts.SourceFile }>()
function parse(file: string, text: string): ts.SourceFile {
  const hit = parsed.get(file)
  if (hit && hit.text === text) return hit.sf
  const kind = /\.tsx$/i.test(file) ? ts.ScriptKind.TSX : /\.jsx$/i.test(file) ? ts.ScriptKind.JSX : ts.ScriptKind.TS
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind)
  parsed.set(file, { text, sf })
  if (parsed.size > 16) parsed.delete(parsed.keys().next().value!)
  return sf
}

/** The innermost token-like node at an offset: an identifier or a literal, else the innermost node. */
function nodeAt(sf: ts.SourceFile, offset: number): ts.Node | undefined {
  let found: ts.Node | undefined
  const visit = (n: ts.Node) => {
    if (offset < n.getStart(sf) || offset > n.getEnd()) return
    found = n
    n.forEachChild(visit)
  }
  sf.forEachChild(visit)
  return found
}

/** The net names an expression may mean: `UP.DP` is `UP/DP` or `DP`, `GND` is `GND`. */
function candidates(e: ts.Node): string[] {
  const parts: string[] = []
  let n: ts.Node = e
  while (ts.isPropertyAccessExpression(n)) {
    parts.unshift(n.name.text)
    n = n.expression
  }
  if (!ts.isIdentifier(n)) return parts.length ? [parts[parts.length - 1]] : []
  parts.unshift(n.text)
  const out = [parts.join('/')]
  if (parts.length > 1) out.push(parts.slice(1).join('/'))
  if (parts[parts.length - 2] === 'nets') out.push(parts[parts.length - 1])
  return out
}

const nameOf = (n: ts.Node): string | undefined => (ts.isIdentifier(n) || ts.isStringLiteral(n) ? n.text : undefined)
const calleeText = (e: ts.Expression): string | undefined => (ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : undefined)
const tagOf = (n: ts.JsxElement | ts.JsxSelfClosingElement): string => (ts.isJsxElement(n) ? n.openingElement.tagName : n.tagName).getText()
const within = (p: [number, number], a: [number, number], b: [number, number]) => !(p[0] < a[0] || (p[0] === a[0] && p[1] < a[1]) || p[0] > b[0] || (p[0] === b[0] && p[1] > b[1]))

function relKey(root: string, file: string): string {
  const rel = relative(root, file)
  return isAbsolute(rel) ? file : rel.split(sep).join('/')
}

const lineCache = new Map<string, { stamp: string; lines: string[] }>()
let openText: string | undefined,
  openLines: string[] = []
/** The text from a 1-based position of a file to the end of its line: the open document's, else the file's on disk. */
function textAt(file: string, line: number, col: number, ctx: PreviewContext): string {
  let lines: string[] | undefined
  if (file === ctx.file && ctx.text !== undefined) {
    if (openText !== ctx.text) openLines = (openText = ctx.text).split('\n')
    lines = openLines
  } else {
    try {
      const st = statSync(file),
        stamp = `${st.size}:${st.mtimeMs}`
      let e = lineCache.get(file)
      if (!e || e.stamp !== stamp) lineCache.set(file, (e = { stamp, lines: readFileSync(file, 'utf8').split('\n') }))
      lines = e.lines
    } catch {
      return ''
    }
  }
  return lines[line - 1]?.slice(col - 1) ?? ''
}
