// Mechanics shared by the stack: the outline, the four M3 holes and the controller test pads the jig's pogo pins land on.
// Frame: millimetres, origin at the top-left corner of the outline, x right, y down, seen from the top of the stack.
import type { Net } from '@pcbjs/core'
import { GND, V5, V3V3, SWDIO, SWCLK, NRST, CANH, CANL } from './nets'

export const W = 60, H = 45
export const HOLES = [[3.5, 3.5], [56.5, 3.5], [3.5, 41.5], [56.5, 41.5]] as const

// Test pads on the controller's back, one row along the bottom edge, 4 mm apart for 100 mil pogo pins.
export const TEST_PADS: readonly { name: string; net: Net; x: number; y: number }[] = [
  { name: 'GND', net: GND, x: 18, y: 39 },
  { name: '5V', net: V5, x: 22, y: 39 },
  { name: '3V3', net: V3V3, x: 26, y: 39 },
  { name: 'DIO', net: SWDIO, x: 30, y: 39 },
  { name: 'CLK', net: SWCLK, x: 34, y: 39 },
  { name: 'RST', net: NRST, x: 38, y: 39 },
  { name: 'CANH', net: CANH, x: 42, y: 39 },
  { name: 'CANL', net: CANL, x: 46, y: 39 },
]
