import { h } from '@pcbjs/core/jsx-runtime'
import type { PcbNode } from '@pcbjs/core/internal/types'
import { SchematicError } from '@pcbjs/core/internal/nets'
import { makeFootprint, type FootprintDef, type LibFootprint, type PadDef } from './footprint.js'
import { memoised, mmArg, oneOf, padArgs, show, type HoleOptions } from './gen.js'

/** The shape options of a header; a vertical header has no mating side, so silk 'open' is 'full'. */
export interface PinHeaderShape extends HoleOptions {
  pitch?: number
  rows?: 1 | 2
  silk?: 'full' | 'open' | 'none'
}

// 1.27 mm pitch takes a 0.6 mm drill: KiCad's 0.65 mm leaves a 0.175 mm ring, under the 0.18 mm most fabs ask
const dims = (pitch: number, drill: unknown, pad: unknown) => padArgs('PinHeader', drill, pad, pitch > 2 ? 1.0 : 0.6, pitch > 2 ? [1.7, 1.7] : [1.0, 1.0])

/** Pin 1 at the origin, pins down +y and rows along +x; the first pad square. */
function headerPads(pins: number, rows: number, pitch: number, hole: ReturnType<typeof dims>): PadDef[] {
  const [pw, ph] = hole.size
  const round = pw === ph
  const out: PadDef[] = []
  for (let i = 0; i < pins; i++)
    for (let r = 0; r < rows; r++) {
      const num = String(out.length + 1)
      const shape = i === 0 && r === 0 ? 'rect' : round ? 'circle' : 'oval'
      out.push({ num, name: num, x: r * pitch, y: i * pitch, w: pw, h: ph, drill: hole.drill, shape })
    }
  return out
}

function headerDef(pins: number, pitch: number, rows: number, hole: ReturnType<typeof dims>): FootprintDef {
  const dia = Math.max(...hole.size)
  // the outline sits half a pitch out from the pad centres; on a fine pitch it moves out to clear the pad, its mask and the line
  const grow = Math.max(0, Math.round((dia / 2 + 0.2 - pitch / 2) * 1e4) / 1e4)
  const w = pitch * rows,
    l = pitch * pins
  const cx = (w - pitch) / 2,
    cy = (l - pitch) / 2
  const silk: PcbNode[] = [
    h('rect', { layer: 'F.SilkS', x: cx - w / 2 - grow, y: cy - l / 2 - grow, w: w + 2 * grow, h: l + 2 * grow }),
    h('line', { layer: 'F.SilkS', x1: -pitch / 2 - grow - 0.3, y1: -pitch / 2, x2: -pitch / 2 - grow - 0.3, y2: pitch / 2 }),
  ]
  return {
    id: `pcbjs:PinHeader_${rows}x${String(pins).padStart(2, '0')}_P${pitch.toFixed(2)}mm_Vertical${hole.suffix}`,
    name: 'PinHeader',
    value: `Conn_${rows < 2 ? '01' : '02'}x${String(pins).padStart(2, '0')}`,
    prefix: 'J',
    pads: headerPads(pins, rows, pitch, hole),
    body: { cx, cy, w, h: l },
    height: 8.5,
    model: { kind: 'header', pins, rows, pitch },
    courtyard: [{ cx, cy, w: w + 0.5, h: l + 0.5 }],
    silk,
    pin1: false,
  }
}

/** A 2.54 or 1.27 mm pin header footprint: `PinHeader(3)('x')` makes a part; `pins` counts one row. */
export function PinHeader(pins: number, opts: PinHeaderShape = {}): LibFootprint<`${number}`> {
  if (opts === null || typeof opts !== 'object') throw new TypeError(`PinHeader: the options must be an object such as { rows: 2 }, got ${show(opts)}`)
  const { pitch, rows, drill, pad, silk } = opts
  if (silk !== undefined) oneOf('PinHeader', 'silk', silk, ['full', 'open', 'none'] as const)
  if (typeof pins !== 'number' || !Number.isInteger(pins) || pins < 1) throw new SchematicError(`PinHeader needs a pin count, a whole number of at least 1, got ${show(pins)}`)
  if (pitch !== undefined) mmArg('PinHeader', 'pitch', pitch, 'a positive number of mm such as 2.54 or 1.27')
  if (rows !== undefined) oneOf('PinHeader', 'rows', rows, [1, 2] as const)
  const hole = dims(pitch ?? 2.54, drill, pad)
  return memoised('PinHeader', [pins, pitch ?? 2.54, rows ?? 1, drill ?? null, pad ?? null, silk ?? null], () =>
    makeFootprint<`${number}`>(headerDef(pins, pitch ?? 2.54, rows ?? 1, hole), silk === 'none' ? { silk: 'none' } : {}),
  )
}
