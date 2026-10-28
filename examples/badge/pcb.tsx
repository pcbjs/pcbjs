// Badge: a round 40 mm wearable badge with a flat bottom edge, an ATtiny85 charlieplexing six rim LEDs, run from a CR2032 on the back.
// Frame: millimetres, origin at the top-left corner of the 40 mm circle's bounding box, x right, y down; the circle's centre is at 20 20.
import PCB from '@pcbjs/fab/OSHPark/2-Layer' // OSH Park: purple ENIG is the only mask colour the preset offers
import { nets, route, pour, keepout, NC, type PcbNode } from '@pcbjs/core'
import { Brand, R0603, C0603, LED0603, slot, circle, npth } from '@pcbjs/lib'
import { strokeText } from '@pcbjs/lib/fonts'
import { SOIC8, CR2032, Tact, Slide, Pogo } from './lib/parts'

// Geometry: the circle is cut flat at y = FLAT, 3 mm above its bottom, so the badge stands on a table.
const CX = 20,
  CY = 20,
  R = 20,
  FLAT = 37
const half = Math.sqrt(R * R - (FLAT - CY) ** 2)
const OUTLINE = `M ${CX - half} ${FLAT} A ${R} ${R} 0 1 1 ${CX + half} ${FLAT} Z`
const polar = (r: number, deg: number): [number, number] => [CX + r * Math.cos((deg * Math.PI) / 180), CY + r * Math.sin((deg * Math.PI) / 180)]

// Curved silk text: one <text> per character, centred on its own arc length, upright when read from outside the rim.
// `from` is the angle of the first character in degrees, y down, so 270 is the top; the text runs clockwise.
function arcText(str: string, r: number, from: number, size: number, layer = 'F.SilkS'): PcbNode[] {
  const out: PcbNode[] = []
  let s = 0
  for (const ch of str) {
    const w = strokeText(ch, { size, thickness: 0.15, anchor: 'start' }).width
    const deg = from + ((s + w / 2) / r) * (180 / Math.PI)
    const [x, y] = polar(r, deg)
    if (ch !== ' ')
      out.push(
        <text layer={layer} at={[x, y, -deg - 90]} size={size}>
          {ch}
        </text>,
      )
    s += w
  }
  return out
}

// Nets: P0..P2 are the MCU pins, L0..L2 the charlieplex lines behind the 100 R resistors.
const { VBAT, VCC, GND, RST, BTN, P0, P1, P2, L0, L1, L2 } = nets()

// Parts
const U1 = SOIC8('ATtiny85', { MPN: 'ATTINY85-20SU' }).connect(RST, BTN, NC, GND, P0, P1, P2, VCC)
const C1 = C0603('100n', { MPN: 'CL10B104KB8NNNC' }).connect(VCC, GND)
const R1 = R0603('100', { MPN: 'RC0603FR-07100RL' }).connect(P0, L0)
const R2 = R0603('100', { MPN: 'RC0603FR-07100RL' }).connect(P1, L1)
const R3 = R0603('100', { MPN: 'RC0603FR-07100RL' }).connect(P2, L2)
const R4 = R0603('10k', { MPN: 'RC0603FR-0710KL' }).connect(VCC, RST)
// charlieplex pairs, anode first: each line pair carries two LEDs in opposite directions
const PAIRS = [
  [L0, L1],
  [L1, L0],
  [L1, L2],
  [L2, L1],
  [L2, L0],
  [L0, L2],
] as const
const LEDS = PAIRS.map(([a, k]) => LED0603('red', { MPN: 'LTST-C190KRKT' }).connect({ A: a, K: k }))
const SW1 = Tact('BOOT', { MPN: 'PTS810SJM250SMTRLFS' }).connect(BTN, BTN, GND, GND)
const SW2 = Slide('ON', { MPN: 'JS102011SAQN' }).connect(VBAT, VCC, NC)
const BT1 = CR2032('CR2032', { MPN: '3034' }).connect(VBAT, GND)
const J1 = Pogo('ISP').connect(P1, VCC, P2, P0, RST, GND)

export default (
  <PCB name="Badge" revision="A" color="purple" autoroute={{ layers: ['F.Cu', 'B.Cu'] }}>
    {/* outline: 40 mm circle cut flat at the bottom, plus the lanyard slot and two M3 holes as cutouts */}
    <path layer="Edge.Cuts" d={OUTLINE} />
    <path layer="Edge.Cuts" d={slot(16, 4.2, 24, 4.2, 2.2)} />
    <footprint ref="H1" at="9 26" bom={false} pos={false} height={0} model={{ kind: 'box', w: 0, h: 0, height: 0 }}>
      {npth(0, 0, 3.2)}
    </footprint>
    <footprint ref="H2" at="31 26" bom={false} pos={false} height={0} model={{ kind: 'box', w: 0, h: 0, height: 0 }}>
      {npth(0, 0, 3.2)}
    </footprint>

    {/* MCU and its support parts in the middle of the front */}
    <U1 at="20 18" />
    <C1 at="24.5 13.5" />
    <R4 at="17 13" />
    <R1 at="27 16.5 90deg" />
    <R2 at="29 16.5 90deg" />
    <R3 at="31 16.5 90deg" />

    {/* six LEDs on a 15 mm radius, every 60 degrees, turned tangent to the rim */}
    {LEDS.map((D, i) => {
      const deg = i * 60
      const [x, y] = polar(15, deg)
      return <D at={[x, y, -deg - 90]} />
    })}

    {/* controls: the button below the MCU, the power switch on the left */}
    <SW1 at="20 26" />
    <SW2 at="10.5 14" />

    {/* programming: pogo pads above the flat edge */}
    <J1 at="20 32.5" />

    {/* back: the coin cell, centred under the MCU; side B mirrors its + tab to the left */}
    <BT1 at={[CX, CY]} side="B" />
    {/* no routed tracks on the back across the cell's - contact; vias and the GND pour may reach it */}
    {keepout('B.Cu', circle(8, CX, CY), { vias: false, pours: false })}

    {/* routes: power and ground drops first, then every signal net to the autorouter */}
    {route(BT1['+'], SW2[1]).width(0.4)}
    {route(U1[4], '16 21.5 B.Cu').width(0.3)}
    {route(C1[2], '25.8 11.8 B.Cu').width(0.3)}
    {route(SW1[3], '16.4 28.4 B.Cu').width(0.3)}
    {route(SW1[4], '23.6 28.4 B.Cu').width(0.3)}
    {route(J1[6], '24.6 34.6 B.Cu', 'L 24.6 34 @B.Cu Z').width(0.3)}
    <track layer="F.Cu" width={0.3} net={VCC} />
    {[RST, BTN, P0, P1, P2, L0, L1, L2].map(n => (
      <track layer="F.Cu" width={0.2} net={n} />
    ))}
    {/* laid out for a solid pour: the dense pads would starve thermal reliefs */}
    {pour(GND, 'B.Cu', OUTLINE, { connect: 'solid' })}

    {/* silk: rim text, a lightning logo, and the back legend mirrored by its layer */}
    {arcText('PCBJS', 17.6, 205, 1.2)}
    {arcText('BADGE', 17.6, 300, 1.2)}
    <path layer="F.SilkS" fill d="M 20.6 6.6 L 18.6 9.6 H 19.9 L 19.3 12 L 21.4 8.8 H 20.1 Z" />
    <text layer="B.SilkS" at="20 33.5" size={1}>
      {'pcbjs badge rev A\nCR2032 + up'}
    </text>
    <Brand at="7.5 30.5" height={4} only="mark" />
  </PCB>
)
