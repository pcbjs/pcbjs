// Blinky, the schematic: three LED channels switched by one transistor, fed from a three-pin header, and its picture.
// J1, Q1 and C1 sit at the board level, each named by its constant; each channel is an instance of the ledChannel circuit with its index.
// A channel's parts take its index: R and D of CH1 are R1 and D1, of CH2 R2 and D2, of CH3 R3 and D3.
// D and Q1 carry their part numbers inline; J1, the resistors and C1 get theirs from blinky.sourcing.ts.
// #region example
import { nets, Schematic, Sheet, Power, Text, wire } from '@pcbjs/core'
import { PinHeader, C0603 } from '@pcbjs/lib'
import { SOT23 } from './lib/MyPart'
import { schematic as ledChannel } from './lib/led-channel'

export const { GND, VCC, SIG, SW } = nets()
export const J1 = PinHeader(3)().connect({ 1: GND, 2: VCC, 3: SIG })
export const Q1 = SOT23('MMBT3904').source({ MPN: 'MMBT3904LT1G', Manufacturer: 'onsemi' }).connect({ 1: SIG, 2: GND, 3: SW })

// decoupling on the supply
export const C1 = C0603('100n').connect({ 1: VCC, 2: GND })

// the channels: CH1.R is a resistor, CH1.nets.led the net between it and CH1.D
export const CH1 = ledChannel({ VCC, SW }, 'CH1')
export const CH2 = ledChannel({ VCC, SW }, 'CH2')
export const CH3 = ledChannel({ VCC, SW }, 'CH3')

// the picture: a part inside <Schematic> is its symbol; where each sits and the wires drawn by hand, in grid units of 2.54 mm;
// GND and VCC get power symbols from the compiler, and C1 is placed but wired by it too
const channel = (ch: typeof CH1, y: number) => (
  <Sheet group={ch} at={`23 ${y}`}>
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
