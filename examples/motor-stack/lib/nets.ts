// Nets shared by the three boards. A net is known by its name, so the controller, the driver and the jig agree on these by importing them.
import { nets } from '@pcbjs/core'

// supplies: the motor bus and the 5 V the driver hands up to the controller
export const { VM, V5, V12, V3V3, GND } = nets({ VM: { class: 'power' }, V5: { class: 'power' }, V12: { class: 'power' } })

// the board to board header: six active low gate commands, three shunt voltages, the bus divider, fault and shutdown
export const { nHA, nLA, nHB, nLB, nHC, nLC, ISA, ISB, ISC, VSNS, nFAULT, SD } = nets()

// what the jig reaches on the controller
export const { SWDIO, SWCLK, NRST, CANH, CANL } = nets()
