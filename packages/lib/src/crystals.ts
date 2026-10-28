// Land patterns follow the KiCad 9 library, Crystal.
import type { StepModelSpec } from '@pcbjs/core/types'
import { makeFootprint, type FootprintDef, type PadDef } from './footprint.js'
import { fetched, kicad3d, outline } from './models.js'

type Model = (box: ReturnType<typeof outline>) => StepModelSpec

function crystal<P extends string>(
  id: string,
  name: string,
  value: string,
  pads: PadDef[],
  body: [number, number],
  height: number,
  model: Model,
  extra: Partial<FootprintDef> = {},
) {
  return makeFootprint<P>({
    id: `pcbjs:${id}`,
    name,
    value,
    prefix: 'Y',
    pads,
    body: { cx: 0, cy: 0, w: body[0], h: body[1] },
    height,
    model: model(outline(body[0], body[1], height)),
    ...extra,
  })
}
const two = (x: number, w: number, h: number, extra: Partial<PadDef> = {}): PadDef[] => [
  { num: '1', name: '1', x: -x, y: 0, w, h, ...extra },
  { num: '2', name: '2', x, y: 0, w, h, ...extra },
]

/** 3.2 x 2.5 mm four-pad crystal, KiCad Crystal_SMD_3225-4Pin_3.2x2.5mm: pads 2 and 4 are the lid, pin GND. */
export const Crystal3225 = crystal<'X1' | 'GND' | 'X2'>(
  'Crystal_SMD_3225-4Pin_3.2x2.5mm',
  'Crystal3225',
  'Crystal 3225',
  [
    { num: '1', name: 'X1', x: -1.1, y: 0.85, w: 1.4, h: 1.2 },
    { num: '2', name: 'GND', x: 1.1, y: 0.85, w: 1.4, h: 1.2 },
    { num: '3', name: 'X2', x: 1.1, y: -0.85, w: 1.4, h: 1.2 },
    { num: '4', name: 'GND', x: -1.1, y: -0.85, w: 1.4, h: 1.2 },
  ],
  [3.2, 2.5],
  0.8,
  b => kicad3d('Crystal.3dshapes/Crystal_SMD_3225-4Pin_3.2x2.5mm.step', b),
  { pins: ['X1', 'GND', 'X2'] },
)

/** 2.0 x 1.2 mm two-pad crystal (KiCad Crystal_SMD_2012-2Pin_2.0x1.2mm), pins 1 and 2. */
export const Crystal2012 = crystal<'1' | '2'>(
  'Crystal_SMD_2012-2Pin_2.0x1.2mm',
  'Crystal2012',
  'Crystal 2012',
  two(0.7, 0.6, 1.1),
  [2.0, 1.2],
  0.5,
  b => fetched('lcsc:C97603', b),
  { pin1: false },
)

/** 3.2 x 1.5 mm two-pad watch crystal, KiCad Crystal_SMD_3215-2Pin_3.2x1.5mm but with pad 1 at -x like every other two-pad part. */
export const Crystal3215 = crystal<'1' | '2'>(
  'Crystal_SMD_3215-2Pin_3.2x1.5mm',
  'Crystal3215',
  'Crystal 3215',
  two(1.25, 1.0, 1.8, { shape: 'rect' }),
  [3.2, 1.5],
  0.9,
  b => kicad3d('Crystal.3dshapes/Crystal_SMD_3215-2Pin_3.2x1.5mm.step', b, undefined, [0, 0, 180]),
  { pin1: false },
)

/** 5.0 x 3.2 mm two-pad crystal (KiCad Crystal_SMD_5032-2Pin_5.0x3.2mm), pins 1 and 2. */
export const Crystal5032 = crystal<'1' | '2'>(
  'Crystal_SMD_5032-2Pin_5.0x3.2mm',
  'Crystal5032',
  'Crystal 5032',
  two(1.85, 2.0, 2.4),
  [5.0, 3.2],
  1.2,
  b => kicad3d('Crystal.3dshapes/Crystal_SMD_5032-2Pin_5.0x3.2mm.step', b),
  { pin1: false },
)

/** HC-49/S low-profile through-hole crystal, 4.88 mm lead spacing (KiCad Crystal_HC49-4H_Vertical), pins 1 and 2. */
export const Crystal49S = crystal<'1' | '2'>(
  'Crystal_HC49-4H_Vertical',
  'Crystal49S',
  'HC-49/S',
  two(2.44, 1.5, 1.5, { shape: 'circle', drill: 0.8 }),
  [11.05, 4.65],
  3.6,
  b => kicad3d('Crystal.3dshapes/Crystal_HC49-4H_Vertical.step', b, [-2.44, 0, 0]),
  { pin1: false },
)
