// The --layers, --fab, --size and --outline of `pcbjs create`: parsed, checked, and drawn into the template's pcb.tsx.
import { FABS } from '@pcbjs/fab'

export type Outline = { kind: 'rect' } | { kind: 'rounded'; r: number } | { kind: 'circle' }

export interface Board {
  fab: string
  layers: number
  /** mm; a circle's diameter is w */
  w: number
  h: number
  outline: Outline
}

export interface BoardFlags {
  layers?: unknown
  fab?: unknown
  size?: unknown
  outline?: unknown
}

/** The corner radius of `rounded` without one, the template's, in mm. */
const RADIUS = 1
/** The template as it is: 20 x 15 mm with 1 mm corners on JLCPCB 2-Layer. */
export const TEMPLATE: Board = { fab: 'JLCPCB/2-Layer', layers: 2, w: 20, h: 15, outline: { kind: 'rounded', r: RADIUS } }
/** The template's circuit spans this block, in mm, and is centred on a larger board. */
const BLOCK = { w: 20, h: 15 }
/** The smallest round board the block fits in, in mm. */
const MIN_CIRCLE = 26
/** A round board's diameter when --size is left out, in mm. */
const CIRCLE = 40

const layersOf = (fab: string) => Number(/(\d+)-Layer/.exec(fab)?.[1])

export function fabs(layers?: number): string[] {
  return FABS.filter(f => layers === undefined || layersOf(f) === layers)
}

export function layerCounts(): number[] {
  return [...new Set(FABS.map(layersOf))].sort((a, b) => a - b)
}

export function parseOutline(v: string): Outline {
  const m = /^(rect|rounded|circle)(?::(\d+(?:\.\d+)?))?$/.exec(v.trim())
  if (!m || (m[2] !== undefined && m[1] !== 'rounded')) throw new Error(`--outline takes rect, rounded, rounded:<radius mm> or circle, got ${JSON.stringify(v)}`)
  if (m[1] === 'rounded') return { kind: 'rounded', r: m[2] === undefined ? RADIUS : Number(m[2]) }
  return { kind: m[1] as 'rect' | 'circle' }
}

/** `50x40` or `50 x 40` in mm; one number for a circle's diameter. */
export function parseBoardSize(v: string, circle: boolean): { w: number; h: number } {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(?:[x×*]\s*(\d+(?:\.\d+)?))?\s*$/i.exec(v)
  if (!m) throw new Error(`--size takes <width>x<height> in mm, or a diameter for a circle, got ${JSON.stringify(v)}`)
  const w = Number(m[1])
  const h = m[2] === undefined ? w : Number(m[2])
  if (circle && w !== h) throw new Error(`a circle takes one diameter, got ${w} x ${h}`)
  if (circle ? w < MIN_CIRCLE : w < BLOCK.w || h < BLOCK.h)
    throw new Error(
      circle ? `a round board needs at least ${MIN_CIRCLE} mm for the template's parts` : `the board needs at least ${BLOCK.w} x ${BLOCK.h} mm for the template's parts`,
    )
  return { w, h }
}

/** The board the flags ask for; a flag left out keeps the template's value, --fab follows --layers. */
export function parseBoard(o: BoardFlags): Board {
  const layers = o.layers === undefined ? undefined : Number(o.layers)
  if (layers !== undefined && !layerCounts().includes(layers)) throw new Error(`--layers takes ${layerCounts().join(', ')}, got ${String(o.layers)}`)
  const fab = o.fab === undefined ? `JLCPCB/${layers ?? TEMPLATE.layers}-Layer` : String(o.fab).replace(/^@pcbjs\/fab\//, '')
  if (!fabs().includes(fab)) throw new Error(`--fab takes one of ${fabs().join(', ')}, got ${JSON.stringify(String(o.fab))}`)
  if (layers !== undefined && layersOf(fab) !== layers) throw new Error(`--fab ${fab} has ${layersOf(fab)} layers, not ${layers}`)
  const outline = o.outline === undefined ? TEMPLATE.outline : parseOutline(String(o.outline))
  const circle = outline.kind === 'circle'
  const size = o.size === undefined ? (circle ? { w: CIRCLE, h: CIRCLE } : TEMPLATE) : parseBoardSize(String(o.size), circle)
  return { fab, layers: layersOf(fab), w: size.w, h: size.h, outline }
}

const num = (v: number) => String(Math.round(v * 1e4) / 1e4)
const WORDS: Record<number, string> = { 2: 'two', 4: 'four', 6: 'six', 8: 'eight' }

function outlineLine(b: Board): { comment: string; d: string; helper: string } {
  const o = b.outline
  if (o.kind === 'circle') return { comment: `${num(b.w)} mm round`, d: `circle(${num(b.w)}, ${num(b.w / 2)}, ${num(b.w / 2)})`, helper: 'circle' }
  if (o.kind === 'rect') return { comment: `${num(b.w)} x ${num(b.h)} mm`, d: `rect(${num(b.w)}, ${num(b.h)})`, helper: 'rect' }
  return { comment: `${num(b.w)} x ${num(b.h)} mm with ${num(o.r)} mm corners`, d: `roundedRect(${num(b.w)}, ${num(b.h)}, ${num(o.r)})`, helper: 'roundedRect' }
}

/** The template's pcb.tsx for the board: its fab, its outline, and every `at` moved so the circuit sits in the middle. */
export function shapeBoard(text: string, b: Board): string {
  const dx = (b.w - BLOCK.w) / 2
  const dy = (b.h - BLOCK.h) / 2
  const o = outlineLine(b)
  const size = b.outline.kind === 'circle' ? `${num(b.w)} mm round` : `${num(b.w)} x ${num(b.h)} mm`
  return text
    .replace(/on a 20 x 15 mm two-layer board/, `on a ${size} ${WORDS[b.layers] ?? b.layers}-layer board`)
    .replace(`'@pcbjs/fab/${TEMPLATE.fab}'`, `'@pcbjs/fab/${b.fab}'`)
    .replace(/\{\/\* outline: [^*]*\*\/\}/, `{/* outline: ${o.comment} */}`)
    .replace(/d=\{roundedRect\(20, 15, 1\)\}/, `d={${o.d}}`)
    .replace(/(import \{[^}]*)\broundedRect\b([^}]*\} from '@pcbjs\/lib')/, `$1${o.helper}$2`)
    .replace(/at="(-?[\d.]+) (-?[\d.]+)/g, (_, x, y) => `at="${num(Number(x) + dx)} ${num(Number(y) + dy)}`)
}
