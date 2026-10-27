import { h } from '@pcbjs/core/jsx-runtime'
import type { FootprintFactory, FootprintProps, Part, PartOptions, PcbNode, PinList } from '@pcbjs/core/types'
import { defineFootprint, SchematicError, type PartInit } from '@pcbjs/core/schematic'
import { courtyard, tht, withGenerated } from './footprint.js'
import { memoised, mmArg, oneOf, padArgs, show, type HoleOptions } from './gen.js'

export interface PinHeaderProps extends FootprintProps, HoleOptions { pins: number; pitch?: number; rows?: 1 | 2; silk?: 'full' | 'open' | 'none' }
/** The shape options of a header; a vertical header has no mating side, so silk 'open' is 'full'. */
export interface PinHeaderShape extends HoleOptions { pitch?: number; rows?: 1 | 2; silk?: 'full' | 'open' | 'none' }
export interface PinHeaderOptions extends PartOptions, PinHeaderShape {}

/** A pin header: `PinHeader(3)` makes a part, `<PinHeader ref="J1" pins={3} />` renders; `pins` counts one row. */
export interface PinHeaderFactory {
  (props: PinHeaderProps): PcbNode
  (pins: number, opts?: string | number | PinHeaderOptions): Part<never>
  (opts: PinHeaderOptions & { pins: number }): Part<never>
  /** the footprint factory of one header: `PinHeader.footprint(3)('x')` makes a part, `<J ref="J1" at="…" />` places one */
  footprint(pins: number, opts?: PinHeaderShape): FootprintFactory<`${number}`>
  readonly pins: PinList
  readonly prefix: string
}

// 1.27 mm pitch takes a 0.6 mm drill: KiCad's 0.65 mm leaves a 0.175 mm ring, under the 0.18 mm most fabs ask
const dims = (pitch: number, drill: unknown, pad: unknown) => padArgs('PinHeader', drill, pad, pitch > 2 ? 1.0 : 0.6, pitch > 2 ? [1.7, 1.7] : [1.0, 1.0])

function renderHeader(props: PinHeaderProps): PcbNode {
  const { pins, pitch = 2.54, rows = 1, drill: drillOpt, pad, silk = 'full', children, ...rest } = props
  const hole = dims(pitch, drillOpt, pad)
  const drill = hole.drill, [pw, ph] = hole.size, dia = Math.max(pw, ph)
  const round = pw === ph
  const pads: PcbNode[] = []
  let n = 1
  for (let i = 0; i < pins; i++)
    for (let r = 0; r < rows; r++)
      pads.push(round
        ? tht(n++, r * pitch, i * pitch, dia, drill, i === 0 && r === 0 ? { shape: 'rect' } : {})
        : tht(n++, r * pitch, i * pitch, dia, drill, { size: [pw, ph], shape: i === 0 && r === 0 ? 'rect' : 'oval' }))
  // the outline sits half a pitch out from the pad centres; on a fine pitch it moves out to clear the pad, its mask and the line
  const grow = Math.max(0, Math.round((dia / 2 + 0.2 - pitch / 2) * 1e4) / 1e4)
  const w = pitch * rows, l = pitch * pins, sw = w + 2 * grow, sl = l + 2 * grow
  const bare = silk === 'none'
  return h('footprint', { id: `pcbjs:PinHeader_${rows}x${String(pins).padStart(2, '0')}_P${pitch.toFixed(2)}mm_Vertical${hole.suffix}${bare ? '_NoSilkScreen' : ''}`, value: `Conn_${rows < 2 ? '01' : '02'}x${String(pins).padStart(2, '0')}`, height: 8.5, ...rest, ...withGenerated({ kind: 'header', pins, rows, pitch }, rest) },
    ...pads,
    h('g', { at: [(w - pitch) / 2, (l - pitch) / 2] },
      courtyard(w + 0.5, l + 0.5),
      bare ? null : h('rect', { layer: 'F.SilkS', x: -sw / 2, y: -sl / 2, w: sw, h: sl }),
      h('rect', { layer: 'F.Fab', x: -w / 2, y: -l / 2, w, h: l }),
    ),
    bare ? null : h('line', { layer: 'F.SilkS', x1: -pitch / 2 - grow - 0.3, y1: -pitch / 2, x2: -pitch / 2 - grow - 0.3, y2: pitch / 2 }),
    children,
  )
}

function headerShape(pins: unknown, o: PinHeaderShape): Pick<PinHeaderProps, 'pins' | 'pitch' | 'rows' | 'drill' | 'pad' | 'silk'> {
  const { pitch, rows, drill, pad, silk } = o
  if (silk !== undefined) oneOf('PinHeader', 'silk', silk, ['full', 'open', 'none'] as const)
  if (typeof pins !== 'number' || !Number.isInteger(pins) || pins < 1) throw new SchematicError(`PinHeader needs a pin count, a whole number of at least 1, got ${show(pins)}`)
  if (pitch !== undefined) mmArg('PinHeader', 'pitch', pitch, 'a positive number of mm such as 2.54 or 1.27')
  if (rows !== undefined) oneOf('PinHeader', 'rows', rows, [1, 2] as const)
  dims(pitch ?? 2.54, drill, pad)
  return { pins, ...(pitch !== undefined ? { pitch } : {}), ...(rows !== undefined ? { rows } : {}), ...(drill !== undefined ? { drill } : {}), ...(pad !== undefined ? { pad } : {}), ...(silk !== undefined ? { silk } : {}) }
}

const headerArgs = (a: unknown, b?: unknown): PartInit => {
  const o = (typeof a === 'object' && a !== null ? a : typeof b === 'string' || typeof b === 'number' ? { value: b, pins: a } : { ...(b as object ?? {}), pins: a }) as PinHeaderOptions & { pins: number }
  const { pins, pitch, rows, drill, pad, silk, ...rest } = o
  return { ...rest, props: headerShape(pins, { pitch, rows, drill, pad, silk }) }
}

const headerPins = (p: { pins: number; rows?: number }) => Array.from({ length: p.pins * (p.rows ?? 1) }, (_, i) => String(i + 1))

export const PinHeader: PinHeaderFactory = defineFootprint(renderHeader, {
  pins: headerPins, prefix: 'J', name: 'PinHeader', args: headerArgs,
}) as any

Object.defineProperty(PinHeader, 'footprint', {
  value: function footprint(pins: number, opts: PinHeaderShape = {}) {
    if (opts === null || typeof opts !== 'object') throw new TypeError(`PinHeader.footprint: the options must be an object such as { rows: 2 }, got ${show(opts)}`)
    const shape = headerShape(pins, opts)
    return memoised('PinHeader.footprint', [shape.pins, shape.pitch ?? 2.54, shape.rows ?? 1, shape.drill ?? null, shape.pad ?? null, shape.silk ?? null], () =>
      defineFootprint(function PinHeader(props: FootprintProps) { return renderHeader({ ...props, ...shape }) }, { pins: headerPins(shape), prefix: 'J', name: 'PinHeader' }))
  },
})
