// Jig schematic: eight pogo pins on the controller's test pads, a debug header for the probe, power and CAN in, a 3.3 V good LED.
import { nets, NC } from '@pcbjs/core'
import { PinHeader, JST_XH, R0603, LED0603 } from '@pcbjs/lib'
import { GND, V5, V3V3, SWDIO, SWCLK, NRST, CANH, CANL } from '../lib/nets'
import { TEST_PADS } from '../lib/mech'
import { PogoPin } from '../lib/footprints'

export { GND, V5, V3V3, SWDIO, SWCLK, NRST, CANH, CANL }
export const { LED_A } = nets()

// one pogo pin per controller test pad, in TEST_PADS order
export const P = TEST_PADS.map(t => PogoPin({ value: `P75-E2 ${t.name}`, source: { MPN: 'P75-E2', Manufacturer: 'generic' } }).connect(t.net))

// the probe's 10 pin Cortex debug cable: VTref from the controller's own 3.3 V
export const J1 = PinHeader(5, { rows: 2, pitch: 1.27, value: 'FTSH-105-01-L-DV-K', source: { MPN: 'FTSH-105-01-L-DV-K', Manufacturer: 'Samtec' } })
  .connect({ 1: V3V3, 2: SWDIO, 3: GND, 4: SWCLK, 5: GND, 6: NC, 7: NC, 8: NC, 9: GND, 10: NRST })
// bench 5 V and the CAN analyser
export const J2 = JST_XH(4, { value: 'B4B-XH-A', source: { MPN: 'B4B-XH-A(LF)(SN)', Manufacturer: 'JST' } }).connect(V5, GND, CANH, CANL)
export const R1 = R0603('1k').connect(V3V3, LED_A)
export const D1 = LED0603('green').connect({ A: LED_A, K: GND })
