// Land patterns follow the KiCad 9 library, LED_SMD.
import { makeFootprint, type GeneratorOptions, type LibFootprint, type PadDef, type PinsOf } from './footprint.js'
import { memoised, oneOf, optsArg } from './gen.js'

/** WS2812B addressable RGB LED: "2020" as KiCad LED_WS2812B-2020_PLCC4_2.0x2.0mm, "5050" as LED_WS2812B_PLCC4_5.0x5.0mm_P3.2mm. */
export function WS2812B<const N extends string = never>(size: '2020' | '5050' = '5050', opts: GeneratorOptions<N> = {}): LibFootprint<PinsOf<'DIN' | 'DOUT' | 'VDD' | 'GND', N>> {
  oneOf('WS2812B', 'the size', size, ['2020', '5050'] as const)
  optsArg('WS2812B', opts, [], 'the second argument, the options,')
  return memoised('WS2812B', [size, opts], () => {
    const small = size === '2020'
    const [x, y, w, hh] = small ? [0.915, 0.55, 0.7, 0.7] : [2.45, 1.65, 1.5, 0.9]
    const names = small ? ['DOUT', 'GND', 'DIN', 'VDD'] : ['VDD', 'DOUT', 'GND', 'DIN']
    const at: [number, number][] = [
      [-x, -y],
      [-x, y],
      [x, y],
      [x, -y],
    ]
    const pads: PadDef[] = at.map(([px, py], i) => ({ num: String(i + 1), name: names[i], x: px, y: py, w, h: hh, shape: small ? 'rect' : 'roundrect' }))
    const b = small ? 2.0 : 5.0,
      height = small ? 0.84 : 1.6
    return makeFootprint(
      {
        id: small ? 'pcbjs:LED_WS2812B-2020_PLCC4_2.0x2.0mm' : 'pcbjs:LED_WS2812B_PLCC4_5.0x5.0mm_P3.2mm',
        name: `WS2812B_${size}`,
        value: small ? 'WS2812B-2020' : 'WS2812B',
        prefix: 'D',
        pads,
        pins: ['DIN', 'DOUT', 'VDD', 'GND'],
        body: { cx: 0, cy: 0, w: b, h: b },
        height,
        model: { kind: 'led', size },
      },
      opts as GeneratorOptions,
    )
  }) as any
}
