// One pixel: a WS2812B-2020 and its 100 nF decoupling cap, with DIN and DOUT ports.
// Local frame: LED centre at the origin, turned 180deg so DIN is on the left and DOUT on the right; x right, y down, mm.
import { circuit, layout, route, via, type Ports, type At } from '@pcbjs/core'
import { C0402 } from '@pcbjs/lib'
import { WS2812B2020 } from './WS2812B2020'

export const PITCH = 6.875

export const pixel = circuit('pixel', ({ VDD, GND, DIN, DOUT }: Ports<'VDD' | 'GND' | 'DIN' | 'DOUT'>) => ({
  LED: WS2812B2020('WS2812B-2020', { MPN: 'WS2812B-2020', 'MPN:LCSC': 'C965555' }).connect({ DIN, DOUT, VDD, GND }),
  C: C0402('100n', { MPN: 'CL05B104KO5NNNC', 'MPN:LCSC': 'C1525' }).connect(VDD, GND),
}))

// Where the data line goes next, in this pixel's frame: the next pixel to the right with the same rotation,
// or the first pixel of the next row, below on screen and turned 180deg; 'up' is that turn seen from a pixel that is itself turned.
export type Step = 'right' | 'down' | 'up' | 'end'

// DOUT pad at (0.8, 0.55) after the 180deg turn; the next DIN at (PITCH - 0.8, -0.55) to the right,
// at (0.8, PITCH + 0.55) after a turn down, and at (0.8, 0.55 - PITCH) after a turn seen from a turned pixel.
const NEXT: Record<Exclude<Step, 'end'>, [[number, number, string], string]> = {
  right: [[PITCH - 0.8, -0.55, 'F.Cu'], 'H 1.6 V -0.55 Z'],
  down: [[0.8, PITCH + 0.55, 'F.Cu'], `H 2 V ${PITCH + 0.55} Z`],
  up: [[0.8, 0.55 - PITCH, 'F.Cu'], `H 2 V ${0.55 - PITCH} Z`],
}

export const PixelCell = layout(pixel, (g, { at, step = 'right' }: { at?: At; step?: Step }) => (
  <g at={at}>
    <g.LED at="0 0 180deg" />
    <g.C at="0 2" refAt="-1.7 0.6 90" />
    {/* GND pads drop to the back pour */}
    {route(g.LED.GND, '0.8 -1.6', 'Z').width(0.25)}
    {via(g.ports.GND, '0.8 -1.6')}
    {route(g.C[2], '1.3 2.6', 'Z').width(0.25)}
    {via(g.ports.GND, '1.3 2.6')}
    {step !== 'end' && route(g.LED.DOUT, NEXT[step][0], NEXT[step][1]).width(0.2)}
  </g>
), 'PixelCell')
