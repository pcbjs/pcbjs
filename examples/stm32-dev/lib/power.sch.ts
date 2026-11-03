// Circuits of the board: the 3.3 V regulator, the two oscillators and the USB-C receptacle with its CC resistors.
// Local names carry their own digits; an instance adds its index, so C1 of the instance LDO2 is C21.
import { circuit, NC, type Ports } from '@pcbjs/core'
import { C0603, R0603 } from '@pcbjs/lib'
import { SOT23Reg, Crystal3225, Crystal3215, USBC } from './parts'

/** XC6206-style LDO with its input capacitor C1 and output capacitor C2. */
export const ldo = circuit('ldo', ({ VIN, VOUT, GND }: Ports<'VIN' | 'VOUT' | 'GND'>) => ({
  U1: SOT23Reg('XC6206P332MR').connect({ GND, VOUT, VIN }),
  C1: C0603('1u').connect({ 1: VIN, 2: GND }),
  C2: C0603('4.7u').connect({ 1: VOUT, 2: GND }),
}))

/** 8 MHz HSE crystal with its load capacitors C1 on XIN and C2 on XOUT; XIN goes to OSC_IN. */
export const hse = circuit('hse', ({ XIN, XOUT, GND }: Ports<'XIN' | 'XOUT' | 'GND'>) => ({
  Y1: Crystal3225('8MHz').connect({ X1: XOUT, GND1: GND, X2: XIN, GND2: GND }),
  C1: C0603('20p').connect({ 1: XIN, 2: GND }),
  C2: C0603('20p').connect({ 1: XOUT, 2: GND }),
}))

/** 32.768 kHz LSE crystal with its load capacitors C1 on XIN and C2 on XOUT; pin 2 goes to PC14. */
export const lse = circuit('lse', ({ XIN, XOUT, GND }: Ports<'XIN' | 'XOUT' | 'GND'>) => ({
  Y1: Crystal3215('32.768k').connect({ 1: XOUT, 2: XIN }),
  C1: C0603('10p').connect({ 1: XIN, 2: GND }),
  C2: C0603('10p').connect({ 1: XOUT, 2: GND }),
}))

/** USB-C sink: both orientations of D+ and D-, 5.1k pull-downs R1 on CC1 and R2 on CC2, SBU open. */
export const usbc = circuit('usbc', ({ VBUS, DP, DN, GND }: Ports<'VBUS' | 'DP' | 'DN' | 'GND'>, { nets: { CC1, CC2 } }) => ({
  J1: USBC('USB-C').connect({
    GND_A: GND,
    VBUS_A: VBUS,
    SBU2: NC,
    CC1,
    DN2: DN,
    DP1: DP,
    DN1: DN,
    DP2: DP,
    SBU1: NC,
    CC2,
    VBUS_B: VBUS,
    GND_B: GND,
    SH1: GND,
    SH2: GND,
    SH3: GND,
    SH4: GND,
  }),
  R1: R0603('5k1').connect({ 1: CC1, 2: GND }),
  R2: R0603('5k1').connect({ 1: CC2, 2: GND }),
}))
