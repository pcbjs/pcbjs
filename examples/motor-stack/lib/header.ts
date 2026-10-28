// The 2 x 10 board to board header, one pinout for both sides of the stack.
// The driver carries a pin header on its top; the controller carries the socket on its bottom, turned 180deg, so its pins mate in mirror order.
import type { Net } from '@pcbjs/core'
import { PinHeader, PinSocket } from '@pcbjs/lib'
import { GND, V5, nHA, nLA, nHB, nLB, nHC, nLC, ISA, ISB, ISC, VSNS, nFAULT, SD } from './nets'

export const ROWS = 10
export const PITCH = 2.54

// net per header pin, pin 1 first; odd pins are the first row
export const B2B: readonly Net[] = [V5, V5, GND, GND, nHA, nLA, nHB, nLB, nHC, nLC, GND, GND, ISA, ISB, ISC, VSNS, nFAULT, SD, GND, GND]

// Pin 1 of the driver header sits here, in the frame both boards share. Rows run along +y, the second column at +x.
export const HEADER_AT = [8, 11] as const

// The socket pin that lands on header pin n when the socket sits on the back, rotated 180deg, with its pin 1 at the header's last row.
export function mate(n: number): number {
  const r = Math.floor((n - 1) / 2),
    c = (n - 1) % 2
  return 2 * (ROWS - 1 - r) + c + 1
}

// where the controller places its socket: pin 1 above header pin 19
export const SOCKET_AT = `${HEADER_AT[0]} ${HEADER_AT[1] + (ROWS - 1) * PITCH} 180deg`
export const DRIVER_HEADER_AT = `${HEADER_AT[0]} ${HEADER_AT[1]}`

export function driverHeader() {
  const pins: Record<number, Net> = {}
  B2B.forEach((net, i) => {
    pins[i + 1] = net
  })
  return PinHeader(ROWS, { rows: 2, value: 'TSW-110-07-G-D', source: { MPN: 'TSW-110-07-G-D', Manufacturer: 'Samtec' } }).connect(pins)
}

export function controllerSocket() {
  const pins: Record<number, Net> = {}
  B2B.forEach((net, i) => {
    pins[mate(i + 1)] = net
  })
  return PinSocket(ROWS, { rows: 2, value: 'SSW-110-01-G-D' }).source({ MPN: 'SSW-110-01-G-D', Manufacturer: 'Samtec' }).connect(pins)
}

// header pin and socket pin of a net, the first when it has several
export const headerPin = (net: Net) => B2B.indexOf(net) + 1
export const socketPin = (net: Net) => mate(headerPin(net))
