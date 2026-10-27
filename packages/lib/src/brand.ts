import { h } from '@pcbjs/core/jsx-runtime'
import type { At, Length, PcbNode, Rotation } from '@pcbjs/core/types'
import { boardRules, SchematicError } from '@pcbjs/core/schematic'
import { at as parseAt, deg, mm } from '@pcbjs/core/units'
import { JS, JS_WIDTH, MARK, MARK_BOX, MARK_THIN, PCB, WORD_BOX } from './brand-data.js'

export interface BrandProps {
  /** centre of the ink, with an optional rotation */
  at?: At
  rot?: Rotation
  /** ink height in mm */
  height?: Length
  /** a silkscreen layer; a B. layer reads from below */
  layer?: string
  /** draw the mark or the wordmark alone */
  only?: 'mark' | 'wordmark'
}

// BASE_RULES.silkMinWidth, for a Brand rendered outside a compile
const SILK_MIN = 0.15

type Box = readonly number[]
const join = (a: Box, b: Box): Box => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]

/** Rings scaled by k about the box centre, as path data in mm. */
function path(rings: readonly string[], k: number, box: Box): string {
  const cx = (box[0] + box[2]) / 2, cy = (box[1] + box[3]) / 2
  const f = (v: string, c: number) => String(Math.round((Number(v) / 100 - c) * k * 1e4) / 1e4)
  return rings.map(r => 'M' + r.split(' ').map(p => { const [x, y] = p.split(','); return `${f(x, cx)} ${f(y, cy)}` }).join(' L') + 'Z').join('')
}

/** The smallest ink height of `only` that keeps every stroke at the silk minimum width. */
export function brandMinHeight(silkMinWidth: number, only?: BrandProps['only']): number {
  const box = only === 'mark' ? MARK_BOX : only === 'wordmark' ? WORD_BOX : join(MARK_BOX, WORD_BOX)
  const thin = only === 'mark' ? MARK_THIN : JS_WIDTH
  return Math.ceil(silkMinWidth * (box[3] - box[1]) / thin * 100) / 100
}

/** The pcbjs mark beside the wordmark in silk: filled mark and pcb, js as an outline. */
export function Brand(props: BrandProps): PcbNode {
  const { only, layer = 'F.SilkS' } = props
  if (only !== undefined && only !== 'mark' && only !== 'wordmark') throw new SchematicError(`<Brand>: only must be "mark" or "wordmark", got ${JSON.stringify(only)}`)
  const height = mm(props.height ?? 5)
  const min = brandMinHeight(boardRules()?.silkMinWidth ?? SILK_MIN, only)
  if (!(height >= min)) throw new SchematicError(`<Brand>: height ${height} mm is below ${min} mm, the smallest at which its thinnest stroke meets the board's silkMinWidth${only ? ` with only="${only}"` : ''}`)
  const box = only === 'mark' ? MARK_BOX : only === 'wordmark' ? WORD_BOX : join(MARK_BOX, WORD_BOX)
  const k = height / (box[3] - box[1])
  const back = layer.startsWith('B.')
  const l = back ? 'F.' + layer.slice(2) : layer
  const [x, y, r] = parseAt(props.at)
  const fill = [...(only === 'wordmark' ? [] : MARK), ...(only === 'mark' ? [] : PCB)]
  return h('g', { at: [x, y, r + deg(props.rot)], ...(back ? { side: 'B' } : {}) },
    h('path', { layer: l, fill: true, d: path(fill, k, box) }),
    only === 'mark' ? null : h('path', { layer: l, width: JS_WIDTH * k, d: path(JS, k, box) }))
}
