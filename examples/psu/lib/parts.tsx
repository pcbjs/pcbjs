// Footprints of the PSU board that are not in the standard library. Land patterns follow the KiCad 9 footprints of the same
// name, origin at pad 1 as KiCad has it, so KiCad's packages3D models fit them. Frame: mm, x right, y down.
import { defineFootprint, type FootprintProps } from '@pcbjs/core'
import { tht, smd, courtyard, silkOutline } from '@pcbjs/lib'

const fab = (x: number, y: number, w: number, h: number) => <rect layer="F.Fab" x={x} y={y} w={w} h={h} width={0.1} />

// Phoenix Contact MKDS 1,5/2-5,08, 1715721: two screw terminals at 5.08 mm, 13.5 A. The wire entry is at +y.
function MKDS2Footprint(props: FootprintProps) {
  const { children, ...rest } = props
  return (
    <footprint id="psu:TerminalBlock_Phoenix_MKDS-1,5-2-5.08" value="1715721" height={10.2} {...rest}>
      {tht(1, 0, 0, 2.6, 1.3, { shape: 'rect' })}
      {tht(2, 5.08, 0, 2.6, 1.3)}
      {fab(-2.54, -5.2, 10.16, 9.8)}
      {silkOutline(10.16, 9.8, { cx: 2.54, cy: -0.3, pads: [{ x: 0, y: 0, w: 2.6, h: 2.6 }, { x: 5.08, y: 0, w: 2.6, h: 2.6 }] })}
      {courtyard(10.66, 10.3, 2.54, -0.3)}
      {children}
    </footprint>
  )
}
export const MKDS2 = defineFootprint(MKDS2Footprint, { pins: ['1', '2'], prefix: 'J', id: 'psu:TerminalBlock_Phoenix_MKDS-1,5-2-5.08' })

// Littelfuse 560 series TR5 fuse holder, 56000001009, with a TR5 fuse: two pins at 5.08 mm under a round 8.5 mm body.
function TR5Footprint(props: FootprintProps) {
  const { children, ...rest } = props
  return (
    <footprint id="psu:Fuseholder_TR5_Littelfuse_No560_No460" value="TR5" height={8} {...rest}>
      {tht(1, 0, 0, 2, 1)}
      {tht(2, 5.08, 0, 2, 1)}
      <circle layer="F.Fab" cx={2.54} cy={0} r={4.25} width={0.1} />
      <circle layer="F.SilkS" cx={2.54} cy={0} r={4.4} width={0.15} />
      {courtyard(10, 10, 2.54, 0)}
      {children}
    </footprint>
  )
}
export const TR5 = defineFootprint(TR5Footprint, { pins: ['1', '2'], prefix: 'F', id: 'psu:Fuseholder_TR5_Littelfuse_No560_No460' })

// TO-220-2 standing upright, TO-220AC rectifiers such as MBR1045: cathode on pad 1 and the tab, anode on pad 2. Tab at -y.
function TO220V2Footprint(props: FootprintProps) {
  const { children, ...rest } = props
  return (
    <footprint id="psu:TO-220-2_Vertical" value="TO-220-2" height={15} {...rest}>
      {tht(1, 0, 0, 2, 1.1, { name: 'K', shape: 'rect' })}
      {tht(2, 5.08, 0, 2, 1.1, { name: 'A' })}
      {fab(-2.46, -3.15, 10, 4.4)}
      {silkOutline(10, 4.4, { cx: 2.54, cy: -0.95, pads: [{ x: 0, y: 0, w: 2, h: 2 }, { x: 5.08, y: 0, w: 2, h: 2 }] })}
      {courtyard(10.5, 4.9, 2.54, -0.95)}
      {children}
    </footprint>
  )
}
export const TO220V2 = defineFootprint(TO220V2Footprint, { pins: ['K', 'A'], prefix: 'D', id: 'psu:TO-220-2_Vertical' })

// Radial electrolytic, 8 mm can, 3.5 mm pitch: + on pad 1, - on pad 2. KiCad's pads are 1.6 on 0.8; these are 2.0 on 1.0
// for hand soldering.
function CP8Footprint(props: FootprintProps) {
  const { children, ...rest } = props
  return (
    <footprint model={{ file: '../models/CP_Radial_D8.0mm_P3.50mm.step' }} id="psu:CP_Radial_D8.0mm_P3.50mm" value="CP" height={11.5} {...rest}>
      {tht(1, 0, 0, 2, 1, { name: '+', shape: 'rect' })}
      {tht(2, 3.5, 0, 2, 1, { name: '-' })}
      <circle layer="F.Fab" cx={1.75} cy={0} r={4} width={0.1} />
      <circle layer="F.SilkS" cx={1.75} cy={0} r={4.12} width={0.15} />
      <path layer="F.SilkS" d="M -2.3 -2.3 h 0.8 M -1.9 -2.7 v 0.8" width={0.15} />
      {courtyard(8.5, 8.5, 1.75, 0)}
      {children}
    </footprint>
  )
}
export const CP8 = defineFootprint(CP8Footprint, { pins: ['+', '-'], prefix: 'C', id: 'psu:CP_Radial_D8.0mm_P3.50mm' })

// Bourns SRR1260 shielded power inductor, 12.5 x 12.5 mm, 6 mm high, two 2.9 x 5.4 mm pads 9.7 mm apart.
function SRR1260Footprint(props: FootprintProps) {
  const { children, ...rest } = props
  return (
    <footprint id="psu:L_Bourns_SRR1260" value="SRR1260" height={6} {...rest}>
      {smd(1, -4.85, 0, 2.9, 5.4, { shape: 'rect' })}
      {smd(2, 4.85, 0, 2.9, 5.4, { shape: 'rect' })}
      {fab(-6.25, -6.25, 12.5, 12.5)}
      {silkOutline(12.5, 12.5, { pads: [{ x: -4.85, y: 0, w: 2.9, h: 5.4 }, { x: 4.85, y: 0, w: 2.9, h: 5.4 }] })}
      {courtyard(13, 13, 0, 0)}
      {children}
    </footprint>
  )
}
export const SRR1260 = defineFootprint(SRR1260Footprint, { pins: ['1', '2'], prefix: 'L', id: 'psu:L_Bourns_SRR1260' })

// TI TPS56637RPA, 4.5 to 28 V, 6 A synchronous buck in the 3 x 3 mm VQFN-HR RPA0010A. Pads read from the land pattern
// example of SLVSEG1A, origin at the package centre: EN, FB, AGND and PG down the left, MODE and NC at the left of the
// top and bottom rows, PGND and SW as long bars, VIN as a bar with three fingers at +x, BOOT at the bottom right.
function RPA10Footprint(props: FootprintProps) {
  const { children, ...rest } = props
  const row = [['EN', -0.75], ['FB', -0.25], ['AGND', 0.25], ['PG', 0.75]] as const
  return (
    <footprint id="psu:TI_VQFN-HR-10_RPA0010A" value="TPS56637" height={1} {...rest}>
      {row.map(([name, y], i) => smd(i + 1, -1.41, y, 0.6, 0.25, { name }))}
      {smd(5, -0.91, 1.43, 0.25, 0.6, { name: 'NC' })}
      {/* the bars sit 0.17 mm apart: a 0.02 mm mask margin, inside TI's 0.05 maximum, keeps the 0.13 mm dam black mask needs */}
      {smd(6, 0.37, 0.865, 0.4, 1.73, { name: 'SW', maskExpansion: 0.02 })}
      {smd(7, 0.9, 1.43, 0.25, 0.6, { name: 'BOOT' })}
      {smd(8, 0.98, -0.67, 0.4, 2.12, { name: 'VIN', maskExpansion: 0.02 })}
      {[-0.75, -0.25, 0.25].map(y => smd(8, 1.45, y, 0.6, 0.25, { name: 'VIN' }))}
      {smd(9, -0.2, -0.67, 0.4, 2.12, { name: 'PGND', maskExpansion: 0.02 })}
      {smd(10, -0.91, -1.43, 0.25, 0.6, { name: 'MODE' })}
      {fab(-1.5, -1.5, 3, 3)}
      <circle layer="F.SilkS" cx={-2.1} cy={-1.3} r={0.1} width={0.2} />
      {courtyard(4.1, 4.1, 0, 0)}
      {children}
    </footprint>
  )
}
export const TPS56637 = defineFootprint(RPA10Footprint, {
  pins: ['EN', 'FB', 'AGND', 'PG', 'SW', 'BOOT', 'VIN', 'PGND', 'MODE'], nc: ['NC'], prefix: 'U', id: 'psu:TI_VQFN-HR-10_RPA0010A',
})
