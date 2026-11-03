// One pixel: a WS2812B-2020 and its 100 nF decoupling cap, with DIN and DOUT ports.
// The instance index numbers both: pixel 12 has the LED D12 and the cap C12.
// Local frame: LED centre at the origin, turned 180deg so DIN is on the left and DOUT on the right; x right, y down, mm.
import { circuit, layout as defineLayout, route, via, type Ports, type At } from '@pcbjs/core'
import { C0402 } from '@pcbjs/lib'
import { WS2812B2020 } from './WS2812B2020'

export const PITCH = 6.875

export const schematic = circuit('pixel', ({ VDD, GND, DIN, DOUT }: Ports<'VDD' | 'GND' | 'DIN' | 'DOUT'>) => ({
  D: WS2812B2020('WS2812B-2020').source({ MPN: 'WS2812B-2020', 'MPN:LCSC': 'C965555' }).connect({ DIN, DOUT, VDD, GND }),
  C: C0402('100n').source({ MPN: 'CL05B104KO5NNNC', 'MPN:LCSC': 'C1525' }).connect({ 1: VDD, 2: GND }),
}))

// Where the data line goes next, in this pixel's frame: the next pixel to the right with the same rotation,
// or the first pixel of the next row, below on screen and turned 180deg; 'up' is that turn seen from a pixel that is itself turned.
export type Step = 'right' | 'down' | 'up' | 'end'

// DOUT pad at (0.8, 0.55) after the 180deg turn; the next DIN at (PITCH - 0.8, -0.55) to the right,
// at (0.8, PITCH + 0.55) after a turn down, and at (0.8, 0.55 - PITCH) after a turn seen from a turned pixel.
// each step is the end, then the x of the H and the y of the V the chain takes to it
const NEXT: Record<Exclude<Step, 'end'>, [[number, number, string], number, number]> = {
  right: [[PITCH - 0.8, -0.55, 'F.Cu'], 1.6, -0.55],
  down: [[0.8, PITCH + 0.55, 'F.Cu'], 2, PITCH + 0.55],
  up: [[0.8, 0.55 - PITCH, 'F.Cu'], 2, 0.55 - PITCH],
}

export const layout = defineLayout(
  schematic,
  (g, { at, step = 'right' }: { at?: At; step?: Step }) => (
    <g at={at}>
      <g.D at="0 0 180deg" />
      <g.C at="0 2" ref:at="-1.7 0.6 90" />
      {/* GND pads drop to the back pour */}
      {route(g.D.GND, '0.8 -1.6').width(0.25).Z()}
      {via(g.ports.GND, '0.8 -1.6')}
      {route(g.C[2], '1.3 2.6').width(0.25).Z()}
      {via(g.ports.GND, '1.3 2.6')}
      {step !== 'end' && route(g.D.DOUT, NEXT[step][0]).width(0.2).H(NEXT[step][1]).V(NEXT[step][2]).Z()}
    </g>
  ),
  'PixelCell',
)
