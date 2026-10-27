// Quad, the schematic: a divider from VIN to GND with SIG in the middle, fed from a two-pin header.
// The divider is a circuit in the object form: Divider.R1 and Divider.R2, numbered R1 and R2 on the board.
import { circuit, nets } from '@pcbjs/core'
import { PinHeader, R0603 } from '@pcbjs/lib'

export const { VIN, GND, SIG } = nets({ VIN: { class: 'power' }, GND: { class: 'power' } })
export const J1 = PinHeader(2)   .connect(VIN, GND)
export const Divider = circuit('Divider', {
  R1: R0603('10k')   .connect(VIN, SIG),
  R2: R0603('10k')   .connect(SIG, GND),
})
