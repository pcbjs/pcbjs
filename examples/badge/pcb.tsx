// Badge: a round 40 mm wearable badge with a flat bottom edge, an ATtiny85 charlieplexing six rim LEDs, run from a CR2032 on the back.
// Frame: millimetres, origin at the top-left corner of the 40 mm circle's bounding box, x right, y down; the circle's centre is at 20 20.
import PCB from '@pcbjs/fab/OSHPark/2-Layer' // OSH Park: purple ENIG is the only mask colour the preset offers
import { nets, route, pour, keepout, NC, type PcbNode } from '@pcbjs/core'
import { Brand, R0603, C0603, LED0603, slot, circle, strokeText } from '@pcbjs/lib'
import { SOIC8, CR2032, Tact, Slide, Pogo, Hole } from './lib/parts'

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
        <text layer={layer} at={`${x} ${y} ${-deg - 90}`} size={size}>
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
const U1 = SOIC8('ATtiny85').source({ MPN: 'ATTINY85-20SU' }).connect({ 1: RST, 2: BTN, 3: NC, 4: GND, 5: P0, 6: P1, 7: P2, 8: VCC })
const C1 = C0603('100n').source({ MPN: 'CL10B104KB8NNNC' }).connect({ 1: VCC, 2: GND })
const R1 = R0603('100').source({ MPN: 'RC0603FR-07100RL' }).connect({ 1: P0, 2: L0 })
const R2 = R0603('100').source({ MPN: 'RC0603FR-07100RL' }).connect({ 1: P1, 2: L1 })
const R3 = R0603('100').source({ MPN: 'RC0603FR-07100RL' }).connect({ 1: P2, 2: L2 })
const R4 = R0603('10k').source({ MPN: 'RC0603FR-0710KL' }).connect({ 1: VCC, 2: RST })
// charlieplex pairs, anode first: each line pair carries two LEDs in opposite directions
const PAIRS = [
  [L0, L1],
  [L1, L0],
  [L1, L2],
  [L2, L1],
  [L2, L0],
  [L0, L2],
] as const
const LEDS = PAIRS.map(([a, k], i) =>
  LED0603('red', { ref: `D${i + 1}` })
    .source({ MPN: 'LTST-C190KRKT' })
    .connect({ A: a, K: k }),
)
const SW1 = Tact('BOOT').source({ MPN: 'PTS810SJM250SMTRLFS' }).connect({ 1: BTN, 2: BTN, 3: GND, 4: GND })
const SW2 = Slide('ON').source({ MPN: 'JS102011SAQN' }).connect({ 1: VBAT, 2: VCC, 3: NC })
const BT1 = CR2032('CR2032').source({ MPN: '3034' }).connect({ '+': VBAT, '-': GND })
const J1 = Pogo('ISP').connect({ 1: P1, 2: VCC, 3: P2, 4: P0, 5: RST, 6: GND })
// two M3 holes, cutouts with no copper
const H1 = Hole()
const H2 = Hole()

export default (
  <PCB name="Badge" rev="A" color="purple" autoroute={{ layers: ['F.Cu', 'B.Cu'] }}>
    {/* outline: 40 mm circle cut flat at the bottom, plus the lanyard slot and two M3 holes as cutouts */}
    <path layer="Edge.Cuts" d={OUTLINE} />
    <path layer="Edge.Cuts" d={slot(16, 4.2, 24, 4.2, 2.2)} />
    <H1 at="9 26" />
    <H2 at="31 26" />

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
      return <D at={`${x} ${y} ${-deg - 90}`} />
    })}

    {/* controls: the button below the MCU, the power switch on the left */}
    <SW1 at="20 26" />
    <SW2 at="10.5 14" />

    {/* programming: pogo pads above the flat edge */}
    <J1 at="20 32.5" />

    {/* back: the coin cell, centred under the MCU; side B mirrors its + tab to the left */}
    <BT1 at={`${CX} ${CY}`} side="B" />
    {/* no routed tracks on the back across the cell's - contact; vias and the GND pour may reach it */}
    {keepout(circle(8, CX, CY), { layers: ['B.Cu'], vias: false, pours: false })}

    {/* routes: power and ground drops first, then every signal net to the autorouter */}
    {route(BT1['+'], SW2[1]).width(0.4)}
    {route(U1[4], '16 21.5 B.Cu').width(0.3)}
    {route(C1[2], '25.8 11.8 B.Cu').width(0.3)}
    {route(SW1[3], '16.4 28.4 B.Cu').width(0.3)}
    {route(SW1[4], '23.6 28.4 B.Cu').width(0.3)}
    {route(J1[6], '24.6 34.6 B.Cu').width(0.3).L(24.6, 34).via('B.Cu').Z()}
    {route(VCC).width(0.3)}
    {[RST, BTN, P0, P1, P2, L0, L1, L2].map(n => route(n).width(0.2))}
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
