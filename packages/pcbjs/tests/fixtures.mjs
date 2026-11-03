// Small boards built with h(), no JSX.
import PCB, { h, route } from '@pcbjs/core'
import { PinHeader } from '@pcbjs/lib/internal/headers'
import { R0603 } from '@pcbjs/lib/internal/passives'
import { compileBoard } from '@pcbjs/compile'
import { netOf, place } from './parts.mjs'

export const outline = () => h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 10, h: 10 })

/**
 * J1 at (2,2) and J2 at (7,2), 1x2 headers with pins along +y (pad 2 at y = 4.54).
 * Net A is routed on F.Cu from J1.1 to J2.1; net B is left unrouted.
 */
export function baseBoard(extra = []) {
  return h(
    PCB,
    { name: 'Test' },
    outline(),
    place(PinHeader(2), { ref: 'J1', at: '2 2', 'net:1': 'A', 'net:2': 'B' }),
    place(PinHeader(2), { ref: 'J2', at: '7 2', 'net:1': 'A', 'net:2': 'B' }),
    route('2 2').net(netOf('A')).width(0.3).L(7, 2),
    ...extra,
  )
}

export const compiledBase = () => compileBoard(baseBoard())

export function bomBoard() {
  return compileBoard(
    h(
      PCB,
      { name: 'Bom' },
      outline(),
      place(PinHeader(2), { ref: 'J1', at: '2 2' }),
      place(R0603, { ref: 'R2', at: '7 7', value: '10k' }),
      place(R0603, { ref: 'R1', at: '7 5', value: '10k' }),
      place(R0603, { ref: 'R3', at: '4 8', value: '1k' }),
    ),
  )
}

export { PCB, h, PinHeader, compileBoard }
