// Circuits of the board: the 3.3 V regulator, the two oscillators and the USB-C receptacle with its CC resistors.
import { circuit, NC, type Ports } from '@pcbjs/core'
import { C0603, R0603 } from '@pcbjs/lib'
import { SOT23Reg, Crystal3225, Crystal3215, USBC } from './parts'

/** XC6206-style LDO with its input and output capacitors. */
export const ldo = circuit('ldo', ({ VIN, VOUT, GND }: Ports<'VIN' | 'VOUT' | 'GND'>) => ({
  U: SOT23Reg('XC6206P332MR').connect({ GND, VOUT, VIN }),
  CIN: C0603('1u').connect(VIN, GND),
  COUT: C0603('4.7u').connect(VOUT, GND),
}))

/** 8 MHz HSE crystal with its two load capacitors; XIN goes to OSC_IN. */
export const hse = circuit('hse', ({ XIN, XOUT, GND }: Ports<'XIN' | 'XOUT' | 'GND'>) => ({
  Y: Crystal3225('8MHz').connect({ X1: XOUT, GND1: GND, X2: XIN, GND2: GND }),
  CIN: C0603('20p').connect(XIN, GND),
  COUT: C0603('20p').connect(XOUT, GND),
}))

/** 32.768 kHz LSE crystal with its two load capacitors; pin 2 goes to PC14. */
export const lse = circuit('lse', ({ XIN, XOUT, GND }: Ports<'XIN' | 'XOUT' | 'GND'>) => ({
  Y: Crystal3215('32.768k').connect(XOUT, XIN),
  CIN: C0603('10p').connect(XIN, GND),
  COUT: C0603('10p').connect(XOUT, GND),
}))

/** USB-C sink: both orientations of D+ and D-, 5.1k pull-downs on CC1 and CC2, SBU open. */
export const usbc = circuit('usbc', ({ VBUS, DP, DN, GND }: Ports<'VBUS' | 'DP' | 'DN' | 'GND'>, { nets: { CC1, CC2 } }) => ({
  J: USBC('USB-C').connect({
    GND_A: GND, VBUS_A: VBUS, SBU2: NC, CC1, DN2: DN, DP1: DP, DN1: DN, DP2: DP, SBU1: NC, CC2, VBUS_B: VBUS, GND_B: GND,
    SH1: GND, SH2: GND, SH3: GND, SH4: GND,
  }),
  RCC1: R0603('5k1').connect(CC1, GND),
  RCC2: R0603('5k1').connect(CC2, GND),
}))
