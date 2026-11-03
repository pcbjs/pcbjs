// The one render spec of `session/render`, `pcbjs shot` and later the MCP render tool; docs/render.md has each field.
import type { Camera } from '@pcbjs/renderer'

export const VIEWS = ['2d', '3d', 'sch'] as const
export type View = (typeof VIEWS)[number]
export const PRESETS = ['iso', 'top', 'bottom', 'front'] as const
export type Preset = (typeof PRESETS)[number]
export const THEMES = ['light', 'dark', 'hc'] as const
export type Theme = (typeof THEMES)[number]

/** A primitive drawn over the view at a layer's elevation, in board mm. */
export interface Mark {
  type: 'marker' | 'ring' | 'line' | 'label'
  at: [number, number]
  /** the line's other end */
  to?: [number, number]
  /** the label's text */
  text?: string
  /** whose elevation it sits at, default F.Cu */
  layer?: string
  /** CSS hex */
  color?: string
  /** output px */
  radius?: number
  /** 'always' draws it through the board; default by its layer and the camera */
  depth?: 'test' | 'always'
}

export interface RenderSpec {
  view: View
  /** the entry, relative to the project, when it has several */
  entry?: string
  /** a target of a board with variants, the first by default */
  target?: string
  camera?: Preset | Camera
  /** a reference, finding id, net, group path, or a box `x0,y0,x1,y1` in board mm */
  frame?: string
  /** mm around the framed box, default 1 */
  margin?: number
  highlight?: string[]
  /** 0 to 1, how far the rest fades, default 0.6 with a highlight */
  dim?: number
  /** a layer group or layer id to 0 to 1 */
  opacity?: Record<string, number>
  /** the layer groups or ids shown, every one by default */
  layers?: string[]
  side?: 'F' | 'B'
  mirror?: boolean
  /** 0 to 1 of the full separation */
  explode?: number
  theme?: Theme
  /** output px */
  size?: [number, number]
  /** supersampling, 1 to 4 */
  quality?: number
  /** findings marked: `all`, or finding ids and rule names */
  findings?: string[]
  marks?: Mark[]
}

export const DEFAULT_SIZE: [number, number] = [1280, 960]
export const MAX_EDGE = 4096

const fail = (msg: string): never => {
  throw new Error(`render: ${msg}`)
}
const num = (v: unknown, name: string, lo: number, hi: number): number => {
  const n = Number(v)
  return Number.isFinite(n) && n >= lo && n <= hi ? n : fail(`${name} must be a number from ${lo} to ${hi}, got ${JSON.stringify(v)}`)
}
const strs = (v: unknown, name: string): string[] => (Array.isArray(v) && v.every(s => typeof s === 'string' && s) ? (v as string[]) : fail(`${name} must be a list of strings`))
const pt = (v: unknown, name: string): [number, number] => (Array.isArray(v) && v.length === 2 && v.every(Number.isFinite) ? [v[0], v[1]] : fail(`${name} must be [x, y] in mm`))

function markOf(m: any, i: number): Mark {
  const at = `marks[${i}]`
  if (!m || !['marker', 'ring', 'line', 'label'].includes(m.type)) fail(`${at}.type must be marker, ring, line or label`)
  if (m.type === 'line' && !m.to) fail(`${at} is a line and needs to`)
  if (m.type === 'label' && (typeof m.text !== 'string' || !m.text)) fail(`${at} is a label and needs text`)
  if (m.color !== undefined && !/^#[0-9a-f]{6}$/i.test(m.color)) fail(`${at}.color must be #rrggbb`)
  if (m.depth !== undefined && m.depth !== 'test' && m.depth !== 'always') fail(`${at}.depth must be test or always`)
  return {
    type: m.type,
    at: pt(m.at, `${at}.at`),
    ...(m.to ? { to: pt(m.to, `${at}.to`) } : {}),
    ...(m.text ? { text: String(m.text) } : {}),
    ...(m.layer ? { layer: String(m.layer) } : {}),
    ...(m.color ? { color: m.color } : {}),
    ...(m.radius !== undefined ? { radius: num(m.radius, `${at}.radius`, 1, 256) } : {}),
    ...(m.depth ? { depth: m.depth } : {}),
  }
}

/** A spec from a request's JSON, every field checked; throws naming the first bad one. */
export function parseSpec(p: any): RenderSpec {
  if (!p || typeof p !== 'object') fail('the request needs a spec object')
  const view = p.view ?? '3d'
  if (!VIEWS.includes(view)) fail(`view must be 2d, 3d or sch, got ${JSON.stringify(view)}`)
  const s: RenderSpec = { view }
  if (p.entry !== undefined) s.entry = String(p.entry)
  if (p.target !== undefined) s.target = String(p.target)
  if (p.camera !== undefined) {
    if (typeof p.camera === 'string') s.camera = PRESETS.includes(p.camera) ? p.camera : fail(`camera must be ${PRESETS.join(', ')} or a camera object`)
    else if (p.camera && typeof p.camera === 'object' && typeof p.camera.type === 'string') s.camera = p.camera
    else fail('camera must be a preset or a camera object of docs/viewer.md')
  }
  if (p.frame !== undefined) s.frame = typeof p.frame === 'string' && p.frame ? p.frame : fail('frame must be a reference or x0,y0,x1,y1')
  if (p.margin !== undefined) s.margin = num(p.margin, 'margin', 0, 1000)
  if (p.highlight !== undefined) s.highlight = strs(p.highlight, 'highlight')
  if (p.dim !== undefined) s.dim = num(p.dim, 'dim', 0, 1)
  if (p.opacity !== undefined) {
    if (!p.opacity || typeof p.opacity !== 'object') fail('opacity must map layer groups to 0 to 1')
    s.opacity = Object.fromEntries(Object.entries(p.opacity).map(([k, v]) => [k, num(v, `opacity.${k}`, 0, 1)]))
  }
  if (p.layers !== undefined) s.layers = strs(p.layers, 'layers')
  if (p.side !== undefined) s.side = p.side === 'F' || p.side === 'B' ? p.side : fail('side must be F or B')
  if (p.mirror !== undefined) s.mirror = !!p.mirror
  if (p.explode !== undefined) s.explode = num(p.explode, 'explode', 0, 1)
  if (p.theme !== undefined) s.theme = THEMES.includes(p.theme) ? p.theme : fail(`theme must be ${THEMES.join(', ')}`)
  if (p.size !== undefined) {
    if (!Array.isArray(p.size) || p.size.length !== 2) fail('size must be [width, height]')
    s.size = [Math.round(num(p.size[0], 'size[0]', 16, MAX_EDGE)), Math.round(num(p.size[1], 'size[1]', 16, MAX_EDGE))]
  }
  if (p.quality !== undefined) s.quality = Math.round(num(p.quality, 'quality', 1, 4))
  if (p.findings !== undefined) s.findings = strs(p.findings, 'findings')
  if (p.marks !== undefined) s.marks = Array.isArray(p.marks) ? p.marks.map(markOf) : fail('marks must be a list')
  return s
}

/** `x0,y0,x1,y1` in board mm, null for anything else. */
export function parseBox(text: string): [number, number, number, number] | null {
  const m = /^\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*$/.exec(text)
  if (!m) return null
  const [x0, y0, x1, y1] = m.slice(1).map(Number)
  return [x0, y0, x1, y1].every(Number.isFinite) ? [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)] : null
}

/** The colours a theme gives the canvas, the highlight and the findings. */
export const THEME_COLORS: Record<Theme, { canvas: string; fg: string; accent: string; error: string; warning: string; info: string }> = {
  light: { canvas: '#eceef1', fg: '#1c2027', accent: '#2563eb', error: '#c93636', warning: '#c46a00', info: '#687080' },
  dark: { canvas: '#0e1013', fg: '#e3e6eb', accent: '#6ea8ff', error: '#ff7070', warning: '#ff9f1c', info: '#8b929f' },
  hc: { canvas: '#000000', fg: '#ffffff', accent: '#7fbfff', error: '#ff8a8a', warning: '#ffb347', info: '#c0c0c0' },
}
