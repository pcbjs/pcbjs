// Land patterns follow the KiCad 9 library, Button_Switch_SMD.
import { h } from '@pcbjs/core/jsx-runtime'
import { makeFootprint, type GeneratorOptions, type LibFootprint, type PadDef, type PinsOf } from './footprint.js'
import { memoised, oneOf, optsArg } from './gen.js'
import { fetched, outline } from './models.js'

interface Tact {
  id: string
  value: string
  pads: [number, number, number, number][]
  body: [number, number]
  height: number
  model: string
  rect?: boolean
}

const SMD = 'kicad:Button_Switch_SMD.3dshapes/'

// pads as [x, y, w, h], the top pair pin A, then the bottom pair pin B
const TACT: Record<string, Tact> = {
  // Omron B3FS-1000P class, 6 x 6 mm SMD (KiCad SW_SPST_Omron_B3FS-100xP)
  '6x6': {
    id: 'SW_SPST_Omron_B3FS-100xP',
    value: 'B3FS-1000P',
    pads: [
      [-4, -2.25, 1.6, 1.4],
      [4, -2.25, 1.6, 1.4],
      [-4, 2.25, 1.6, 1.4],
      [4, 2.25, 1.6, 1.4],
    ],
    body: [6, 6.3],
    height: 3.5,
    model: `${SMD}SW_SPST_Omron_B3FS-100xP.step`,
    rect: true,
  },
  // XKB TS-1187A, 5.1 x 5.1 mm, LCSC C318884 (KiCad SW_Push_1P1T_XKB_TS-1187A)
  '5.1x5.1': {
    id: 'SW_Push_1P1T_XKB_TS-1187A',
    value: 'TS-1187A-B-A-B',
    pads: [
      [-3, -1.875, 1, 0.75],
      [3, -1.875, 1, 0.75],
      [-3, 1.875, 1, 0.75],
      [3, 1.875, 1, 0.75],
    ],
    body: [5.1, 5.1],
    height: 1.5,
    model: 'lcsc:C318884',
    rect: true,
  },
  // C&K PTS647, 4.5 x 4.5 mm, 5 mm tall (KiCad SW_SPST_PTS647_Sx50)
  '4.5x4.5': {
    id: 'SW_SPST_PTS647_Sx50',
    value: 'PTS647SN50SMTR',
    pads: [
      [-2.625, -1.6, 1.55, 1],
      [2.625, -1.6, 1.55, 1],
      [-2.625, 1.6, 1.55, 1],
      [2.625, 1.6, 1.55, 1],
    ],
    body: [4.5, 4.5],
    height: 5.0,
    model: `${SMD}SW_SPST_PTS647Sx50.step`,
  },
  // C&K PTS810, 4.2 x 3.2 mm (KiCad SW_SPST_PTS810)
  '4.2x3.2': {
    id: 'SW_SPST_PTS810',
    value: 'PTS810SJM250SMTRLFS',
    pads: [
      [-2.075, -1.075, 1.05, 0.65],
      [2.075, -1.075, 1.05, 0.65],
      [-2.075, 1.075, 1.05, 0.65],
      [2.075, 1.075, 1.05, 0.65],
    ],
    body: [4.2, 3.2],
    height: 2.5,
    model: `${SMD}SW_SPST_PTS810.step`,
    rect: true,
  },
  // XKB TS-1088, 3.9 x 3.0 mm, two pads, LCSC C720477 (KiCad SW_SPST_TS-1088-xR020)
  '3x4': {
    id: 'SW_SPST_TS-1088-xR020',
    value: 'TS-1088-AR02016',
    pads: [
      [-2.225, 0, 1.05, 2],
      [2.225, 0, 1.05, 2],
    ],
    body: [3.9, 3.0],
    height: 2.0,
    model: `${SMD}SW_SPST_TS-1088-xR020.step`,
  },
}

export type TactSize = '6x6' | '5.1x5.1' | '4.5x4.5' | '4.2x3.2' | '3x4'

/** A normally open tactile switch, pins A and B; on four-pad sizes pads 1 and 2 are A, 3 and 4 B. */
export function TactSwitch<const N extends string = never>(size: TactSize = '5.1x5.1', opts: GeneratorOptions<N> = {}): LibFootprint<PinsOf<'A' | 'B', N>> {
  oneOf('TactSwitch', 'the size', size, Object.keys(TACT) as TactSize[])
  optsArg('TactSwitch', opts, [], 'the second argument, the options,')
  return memoised('TactSwitch', [size, opts], () => {
    const t = TACT[size]
    const four = t.pads.length === 4
    const pads: PadDef[] = t.pads.map(([x, y, w, hh], i) => ({
      num: String(i + 1),
      name: four ? (i < 2 ? 'A' : 'B') : i === 0 ? 'A' : 'B',
      x,
      y,
      w,
      h: hh,
      shape: t.rect ? 'rect' : 'roundrect',
    }))
    const [bw, bh] = t.body
    return makeFootprint(
      {
        id: `pcbjs:${t.id}`,
        name: `Tact_${size}`,
        value: t.value,
        prefix: 'SW',
        pads,
        pins: ['A', 'B'],
        body: { cx: 0, cy: 0, w: bw, h: bh },
        height: t.height,
        model: fetched(t.model, outline(bw, bh, t.height)),
        pin1: false,
        extra: [h('circle', { layer: 'F.Fab', r: Math.min(bw, bh) / 4, width: 0.1 })],
      },
      opts as GeneratorOptions,
    )
  }) as any
}

/** An SPDT slide switch, C&K JS102011SAQN as KiCad SW_SPDT_CK_JS102011SAQN, pin 2 the common. */
export function SlideSwitch<const N extends string = never>(pins: 3 = 3, opts: GeneratorOptions<N> = {}): LibFootprint<PinsOf<'1' | '2' | '3', N>> {
  oneOf('SlideSwitch', 'the pin count', pins, [3] as const)
  optsArg('SlideSwitch', opts, [], 'the second argument, the options,')
  return memoised('SlideSwitch', [pins, opts], () =>
    makeFootprint(
      {
        id: 'pcbjs:SW_SPDT_CK_JS102011SAQN',
        name: 'SlideSwitch',
        value: 'JS102011SAQN',
        prefix: 'SW',
        pads: [
          { num: '1', name: '1', x: -2.5, y: -2.75, w: 1.25, h: 2.5 },
          { num: '2', name: '2', x: 0, y: -2.75, w: 1.25, h: 2.5 },
          { num: '3', name: '3', x: 2.5, y: -2.75, w: 1.25, h: 2.5 },
          { num: '', name: '', x: -3.4, y: 0, w: 0.9, h: 0.9, shape: 'circle', drill: 0.9, type: 'npth' },
          { num: '', name: '', x: 3.4, y: 0, w: 0.9, h: 0.9, shape: 'circle', drill: 0.9, type: 'npth' },
        ],
        body: { cx: 0, cy: 0, w: 9.0, h: 3.6 },
        height: 3.5,
        model: fetched('lcsc:C221660', outline(9.0, 3.6, 3.5), [0, -0.47, 0.47]),
        courtyard: [{ cx: 0, cy: -0.125, w: 10, h: 8.75 }],
        extra: [h('rect', { layer: 'F.Fab', x: -0.75, y: 1.8, w: 1.5, h: 2.0, width: 0.1 })],
      },
      opts as GeneratorOptions,
    ),
  ) as any
}
