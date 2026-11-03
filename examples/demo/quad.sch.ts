// Quad, the schematic: a divider from VIN to GND with SIG in the middle, fed from a two-pin header.
// R1 and R2 make the divider; the board places them in a <g name="Divider">, so findings and the viewer name them Divider/R1 and Divider/R2.
import { nets } from '@pcbjs/core'
import { PinHeader, R0603 } from '@pcbjs/lib'

export const { VIN, GND, SIG } = nets({ VIN: { class: 'power' }, GND: { class: 'power' } })
export const J1 = PinHeader(2)().connect({ 1: VIN, 2: GND })
export const R1 = R0603('10k').connect({ 1: VIN, 2: SIG })
export const R2 = R0603('10k').connect({ 1: SIG, 2: GND })
