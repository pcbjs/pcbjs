// One shot of one board by the render spec: 3D through the renderer worker, 2D and the schematic through sharp, then a PNG
// whose tEXt chunks carry the snapshot and the one-line legend returned beside it.
import type { Finding } from '@pcbjs/core/finding'
import type { Compiled } from '../project/project.js'
import { DEFAULT_SIZE, THEME_COLORS, type Mark, type RenderSpec, type Theme } from './spec.js'
import { resolveTarget, type Target } from './targets.js'
import { findingMarks, pickFindings, rgba } from './marks.js'
import { boardView, schematicView } from './flat.js'
import { readGlb, type GlbScene } from './glb.js'
import { annotations, cameraOf, explodeTranslations, frameRequest, groupNodes, styles } from './scene3d.js'
import type { Image, RenderWorker } from './worker-client.js'

export interface ShotInput {
  compiled: Pick<Compiled, 'board' | 'site'>
  /** the board in 3D, read for a 3D shot only: a session fetches it from the compile thread */
  glb(): Promise<Compiled['glb']>
  findings: Finding[]
  project: string
  snapshot: string
  spec: RenderSpec
  /** the session's worker, or one of this process */
  worker(): RenderWorker
}

export interface Shot {
  png: Uint8Array
  legend: string
  width: number
  height: number
  ms: number
}

const scenes = new WeakMap<Uint8Array, GlbScene>()
const sceneOf = (glb: Uint8Array): GlbScene => scenes.get(glb) ?? scenes.set(glb, readGlb(glb)).get(glb)!

/** The marks the spec asks for, the findings it frames or highlights included. */
function marksOf(spec: RenderSpec, findings: Finding[], targets: Target[], theme: Theme): Mark[] {
  const named = new Set(targets.flatMap(t => t.findings))
  for (const x of pickFindings(findings, spec.findings)) named.add(x)
  return [
    ...findingMarks(
      [...named].filter(x => x.at),
      theme,
    ),
    ...(spec.marks ?? []),
  ]
}

export async function rasterSvg(svg: string): Promise<Image> {
  const sharp = (await import('sharp')).default
  const { data, info } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { rgba: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), width: info.width, height: info.height }
}

async function image3d(o: ShotInput, frame: Target | null, highlight: Target[], marks: Mark[], theme: Theme, size: [number, number]): Promise<Image> {
  const { spec, compiled: c } = o
  const glb = await o.glb()
  if (!glb) throw new Error(`render: ${c.board.name} has no 3D scene`)
  const scene = sceneOf(glb)
  const camera = cameraOf(spec)
  const explode = spec.explode ?? 0
  const only = spec.layers?.length ? [...new Set(spec.layers.flatMap(l => groupNodes(l, scene)))] : null
  const options = {
    width: size[0],
    height: size[1],
    supersample: spec.quality ?? 1,
    background: rgba(THEME_COLORS[theme].canvas),
    camera,
    ...(only ? { visibility: { only } } : {}),
    nodeTranslations: explodeTranslations(scene, explode),
    styles: styles(spec, highlight, scene, theme),
    annotations: await annotations(marks, scene, c.site, camera, explode, theme),
    ...(spec.mirror ? { mirror: true } : {}),
  }
  const key = `${o.snapshot}|${c.board.name}|${c.board.variant?.name ?? ''}`
  return o.worker().shot({ key, project: o.project, snapshot: o.snapshot, glb, selection: scene.selection }, frameRequest(spec, frame, scene, c.site), options)
}

const COLOR_NAMES: Record<string, string> = { accent: 'blue', error: 'red', warning: 'amber' }

/** One line: board, view, camera, snapshot and what each colour and fade means. */
export function legendOf(o: ShotInput, marks: Mark[]): string {
  const { spec, compiled: c } = o
  const cam = spec.view === '3d' ? ` ${typeof spec.camera === 'object' ? 'camera' : (spec.camera ?? 'iso')}` : ''
  const parts = [`${c.board.name}${c.board.variant ? ` [${c.board.variant.name}]` : ''} ${spec.view}${cam}`, `snapshot ${o.snapshot}`]
  if (spec.side === 'B' && spec.view !== 'sch') parts.push(`side B${spec.mirror ? ' mirrored' : ''}`)
  else if (spec.mirror && spec.view !== 'sch') parts.push('mirrored')
  if (spec.frame) parts.push(`frame ${spec.frame}`)
  if (spec.highlight?.length) parts.push(`${COLOR_NAMES.accent}: ${spec.highlight.join(', ')}, the rest faded ${Math.round((spec.dim ?? 0.6) * 100)}%`)
  if (spec.layers?.length && spec.view !== 'sch') parts.push(`layers ${spec.layers.join(', ')}`)
  if (spec.explode && spec.view === '3d') parts.push(`explode ${spec.explode}`)
  const rings = marks.filter(m => m.type === 'ring').length
  if (rings && spec.view !== 'sch') parts.push(`${rings} finding${rings === 1 ? '' : 's'} ringed, ${COLOR_NAMES.error} errors, ${COLOR_NAMES.warning} warnings`)
  return parts.join('; ')
}

/** PNG text is Latin-1. */
const latin1 = (s: string) => s.replace(/[^\n\x20-\x7e\xa0-\xff]/g, '?')

export async function renderShot(o: ShotInput): Promise<Shot> {
  const t0 = performance.now()
  const { spec, compiled: c } = o
  const theme = spec.theme ?? 'light'
  const size = spec.size ?? DEFAULT_SIZE
  const target = (text: string) => resolveTarget(text, c.board, c.site, o.findings)
  const frame = spec.frame ? target(spec.frame) : null
  const highlight = (spec.highlight ?? []).map(target)
  const marks = spec.view === 'sch' ? [] : marksOf(spec, o.findings, [...(frame ? [frame] : []), ...highlight], theme)
  const flat = { spec, board: c.board, frame, highlight, marks, theme, size }
  let img: Image
  if (spec.view === '3d') img = await image3d(o, frame, highlight, marks, theme, size)
  else if (spec.view === '2d') img = await rasterSvg(boardView(flat))
  else {
    const svg = schematicView(flat)
    if (!svg) throw new Error(`render: ${c.board.name} has no schematic drawing`)
    img = await rasterSvg(svg)
  }
  const legend = legendOf(o, marks)
  const { encodePng } = await import('@pcbjs/renderer')
  const png = await encodePng(img.rgba, img.width, img.height, { Snapshot: latin1(o.snapshot), Legend: latin1(legend), Software: 'pcbjs' })
  return { png, legend, width: img.width, height: img.height, ms: performance.now() - t0 }
}
