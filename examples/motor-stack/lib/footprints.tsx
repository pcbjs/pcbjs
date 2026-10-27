// Footprints the stdlib lacks, shared by the boards: a DPAK MOSFET, a 2512 shunt, a pogo pin receptacle and a wire pad.
// Frame: millimetres, origin at the footprint centre as in KiCad, x right, y down. Land patterns from KiCad 9's library.
import { defineFootprint, type FootprintProps } from '@pcbjs/core'
import { courtyard, smd } from '@pcbjs/lib/footprint'

// TO-252-2, KiCad Package_TO_SOT_SMD:TO-252-2: gate pad 1, drain tab pad 2, source pad 3; the leads point to -x.
function DPAKFootprint(props: FootprintProps) {
  const { children, ...rest } = props
  return (
    <footprint id="motor:TO-252-2" value="DPAK" height={2.4} model={{ file: './models/TO-252-2.step' }} {...rest}>
      {smd(1, -5.04, -2.28, 2.2, 1.2, { name: 'G' })}
      {smd(2, 1.26, 0, 6.4, 5.8, { name: 'D' })}
      {smd(3, -5.04, 2.28, 2.2, 1.2, { name: 'S' })}
      <rect layer="F.Fab" x={-3.6} y={-3.3} w={6.6} h={6.6} />
      <path layer="F.SilkS" d="M -3.2 -3.45 H -1.8 M -3.2 3.45 H -1.8" />
      <rect layer="F.CrtYd" x={-6.39} y={-3.5} w={11.1} h={7} width={0.05} />
      {children}
    </footprint>
  )
}
export const DPAK = defineFootprint(DPAKFootprint, { pins: ['G', 'D', 'S'], prefix: 'Q', id: 'motor:TO-252-2', name: 'DPAK' })

// 2512 chip resistor, KiCad Resistor_SMD:R_2512_6332Metric, for the shunts.
function R2512Footprint(props: FootprintProps) {
  const { children, ...rest } = props
  return (
    <footprint id="motor:R_2512_6332Metric" value="R2512" height={0.65} model={{ file: './models/R_2512_6332Metric.step' }} {...rest}>
      {smd(1, -2.9625, 0, 1.225, 3.35)}
      {smd(2, 2.9625, 0, 1.225, 3.35)}
      <rect layer="F.Fab" x={-3.15} y={-1.6} w={6.3} h={3.2} />
      <path layer="F.SilkS" d="M -2.1 -1.75 H 2.1 M -2.1 1.75 H 2.1" />
      {courtyard(7.7, 3.84)}
      {children}
    </footprint>
  )
}
export const R2512 = defineFootprint(R2512Footprint, { pins: ['1', '2'], prefix: 'R', id: 'motor:R_2512_6332Metric', name: 'R2512' })

// Receptacle for a 100 mil pogo pin such as the P75 series in an R75-2W socket: one plated 1.7 mm hole.
function PogoPinFootprint(props: FootprintProps) {
  const { children, ...rest } = props
  return (
    <footprint id="motor:PogoPin_R75" value="P75-E2" height={16} {...rest}>
      <pad num={1} at="0 0" size={2.6} drill={1.7} />
      <circle layer="F.SilkS" r={1.6} />
      {courtyard(3.4, 3.4)}
      {children}
    </footprint>
  )
}
export const PogoPin = defineFootprint(PogoPinFootprint, { pins: ['1'], prefix: 'TP', id: 'motor:PogoPin_R75', name: 'PogoPin' })

// A plated hole for a 14 AWG wire or an M3 ring lug, for the motor phases and the bus.
function WirePadFootprint(props: FootprintProps) {
  const { children, ...rest } = props
  return (
    <footprint id="motor:WirePad_3.5" value="WIRE" height={0.1} bom={false} pos={false} {...rest}>
      <pad num={1} at="0 0" size={4.2} drill={2.0} />
      {courtyard(4.8, 4.8)}
      {children}
    </footprint>
  )
}
export const WirePad = defineFootprint(WirePadFootprint, { pins: ['1'], prefix: 'J', id: 'motor:WirePad_3.5', name: 'WirePad' })
