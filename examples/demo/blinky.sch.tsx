// Blinky, the schematic: three LED channels switched by one transistor, fed from a three-pin header, and its picture.
// J1, Q1 and C1 sit at the board level; each channel is an instance of the ledChannel circuit, named by its second argument.
// Refs come from the order of declaration, channels included: J1, Q1, C1, then R1 and D1 of CH1, R2 and D2 of CH2, R3 and D3 of CH3.
// D and Q1 carry their part numbers inline; J1, the resistors and C1 get theirs from blinky.sourcing.ts.
// #region example
import { nets, Schematic, Sheet, Power, Text, wire } from '@pcbjs/core'
import { PinHeader, C0603 } from '@pcbjs/lib'
import { SOT23 } from './lib/MyPart'
import { ledChannel } from './lib/led-channel.sch'

export const { GND, VCC, SIG, SW } = nets()
export const J1 = PinHeader(3)        .connect(GND, VCC, SIG)
export const Q1 = SOT23('MMBT3904', { MPN: 'MMBT3904LT1G', Manufacturer: 'onsemi' }).connect(SIG, GND, SW)

// decoupling on the supply
export const C1 = C0603('100n')       .connect(VCC, GND)

// the channels: CH1.R is a resistor, CH1.nets.led the net between it and CH1.D
export const CH1 = ledChannel({ VCC, SW }, 'CH1')
export const CH2 = ledChannel({ VCC, SW }, 'CH2')
export const CH3 = ledChannel({ VCC, SW }, 'CH3')

// the picture: a part inside <Schematic> is its symbol; where each sits and the wires drawn by hand, in grid units of 2.54 mm;
// GND and VCC get power symbols from the compiler, and C1 is placed but wired by it too
const channel = (ch: typeof CH1, y: number) => (
  <Sheet group={ch} at={[23, y]}>
    <ch.R at="2 2" />
    <ch.D at="8 2" />
    {wire(ch.R[2]).Z(ch.D.A)}
  </Sheet>
)

export const drawing = (
  <Schematic>
    <J1 at="4 7" />
    <Q1 at="13 10" />
    <C1 at="6 18" rot={270} />
    {wire(J1[3]).Z(Q1[1])}
    <Power net={GND} at="14 12" kind="gnd" />
    {channel(CH1, 5)}
    {channel(CH2, 12)}
    {channel(CH3, 19)}
    {wire(CH1.D.K).h(2).v(14).Z(CH3.D.K)}
    {wire(CH2.D.K).h(2)}
    {wire(Q1[3]).V(3).H(35).V(7)}
    <Text at="4 26">Three LED channels switched low by Q1</Text>
  </Schematic>
)
// #endregion example
