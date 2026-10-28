// PSU: 24 V in, 5 V 5 A out, a TPS56637 synchronous buck on a 64 x 42 mm 2-layer board with 2 oz copper.
// Power path: J1 → F1 → D1 reverse protection → VIN pour → U1 → SW pour → L1 → VOUT pour → J2. Ground pours on both sides.
// Frame: mm, origin at the top-left corner of the outline, x right, y down.
import PCB from '@pcbjs/fab/JLCPCB/2-Layer'
import { nets, route, pour, via, keepout, stitch, NC } from '@pcbjs/core'
import { Brand, R0603, C0603, C1206, LED0805, MountingHole, roundedRect, rect, circle } from '@pcbjs/lib'
import { twoLayer } from '@pcbjs/lib/stackups'
import { MKDS2, TR5, TO220V2, CP8, SRR1260, TPS56637 } from './lib/parts'

const W = 64,
  H = 42

// ---- schematic ----
const { VRAW, VFUSE, VIN, SW, BOOT, VOUT, FB, LEDA, GND } = nets()

const J1 = MKDS2({ value: '24V IN', model: { file: './models/TerminalBlock_Phoenix_MKDS-1_5-2-5.08_1x02_P5.08mm_Horizontal.step' } })
  .source({ MPN: '1715721', Manufacturer: 'Phoenix Contact' })
  .connect({ 1: VRAW, 2: GND })
const F1 = TR5({ value: '2A', model: { file: './models/Fuseholder_TR5_Littelfuse_No560_No460.step' } })
  .source({ MPN: '56000001009', Manufacturer: 'Littelfuse', fuse: '37212000411 TR5 2 A' })
  .connect(VRAW, VFUSE)
const D1 = TO220V2({ value: 'MBR1045G', model: { file: './models/TO-220-2_Vertical.step', offset: [0, 0, -3.69] } })
  .source({ MPN: 'MBR1045G', Manufacturer: 'onsemi' })
  .connect({ A: VFUSE, K: VIN })
const C1 = C1206('10u 50V').source({ MPN: 'GRM31CR61H106KA12L' }).connect(GND, VIN)
const C2 = C1206('10u 50V').source({ MPN: 'GRM31CR61H106KA12L' }).connect(GND, VIN)
const C3 = CP8('100u 35V').source({ MPN: 'EEU-FR1V101', Manufacturer: 'Panasonic' }).connect({ '+': VIN, '-': GND })
const U1 = TPS56637('TPS56637').source({ MPN: 'TPS56637RPAR', Manufacturer: 'Texas Instruments' }).connect({ VIN, PGND: GND, AGND: GND, SW, BOOT, FB, EN: NC, PG: NC, MODE: NC }) // EN and MODE float: enabled, FCCM
const C4 = C0603('100n').source({ MPN: 'GRM188R71H104KA93D' }).connect(BOOT, SW)
const L1 = SRR1260({ value: '3.3u', model: { file: './models/L_Bourns_SRR1260.step' } })
  .source({ MPN: 'SRR1260-3R3Y', Manufacturer: 'Bourns' })
  .connect(SW, VOUT)
const C5 = C1206('22u 16V').source({ MPN: 'GRM31CR61C226ME15L' }).connect(GND, VOUT)
const C6 = C1206('22u 16V').source({ MPN: 'GRM31CR61C226ME15L' }).connect(GND, VOUT)
const C7 = CP8('470u 10V').source({ MPN: 'EEU-FR1A471', Manufacturer: 'Panasonic' }).connect({ '+': VOUT, '-': GND })
const R1 = R0603('73.2k').source({ MPN: 'RC0603FR-0773K2L' }).connect(FB, VOUT) // 0.6 V × (1 + 73.2k / 10k) = 4.99 V
const R2 = R0603('10k').source({ MPN: 'RC0603FR-0710KL' }).connect(GND, FB)
const C8 = C0603('150p').source({ MPN: 'GRM1885C1H151JA01D' }).connect(FB, VOUT) // feed-forward, datasheet table 4
const R3 = R0603('2.2k').source({ MPN: 'RC0603FR-072K2L' }).connect(LEDA, VOUT)
const D2 = LED0805('green').source({ MPN: 'LTST-C170GKT' }).connect({ A: LEDA, K: GND })
const J2 = MKDS2({ value: '5V OUT', model: { file: './models/TerminalBlock_Phoenix_MKDS-1_5-2-5.08_1x02_P5.08mm_Horizontal.step' } })
  .source({ MPN: '1715721', Manufacturer: 'Phoenix Contact' })
  .connect({ 1: VOUT, 2: GND })
const Hole = MountingHole(3.2)

const HOLES = [
  [4, 4],
  [W - 4, 4],
  [4, H - 4],
  [W - 4, H - 4],
] as const
const CUTOUT = [14, 34] as const

// ---- pours ----
// the power pours fill first and join their SMD pads solidly; the hand-soldered THT pads in them get reliefs back below.
// Each runs to the board edge so the ground pour does not enclose it: an island in another net's pour once went missing from the Gerber.
const VIN_POUR = 'M25.5 0 H36.8 V13.5 H33.3 V20.3 H30.5 V19.6 H24 V13.5 H25.5 Z'
const VOUT_POUR = 'M38.5 25.2 H56 V19.6 H64 V33 H38.5 Z'

export default (
  <PCB
    name="PSU"
    title="24 V to 5 V 5 A buck"
    revision="0.1.0"
    color="black"
    stackup={twoLayer({ finish: 'HASL', outerCopper: 2 })}
    rules={{ clearance: 0.16, minTrackWidth: 0.16, thermal: { spokeWidth: 0.8 } }}
  >
    <path layer="Edge.Cuts" d={roundedRect(W, H, 4)} />
    {/* a 6 mm cable-tie cutout as two half arcs; drawn counter-clockwise on screen, sweep 0, so the outline offset reads it as a hole */}
    <path layer="Edge.Cuts" d={`M ${CUTOUT[0] - 3} ${CUTOUT[1]} A 3 3 0 0 0 ${CUTOUT[0] + 3} ${CUTOUT[1]} A 3 3 0 0 0 ${CUTOUT[0] - 3} ${CUTOUT[1]} Z`} />

    <J1 at="5.5 18 270deg" />
    <F1 at="11 10" />
    <D1 at="28.08 10 180deg" thermal={{ K: 'thermal' }} />
    <C3 at="34 9" thermal={{ '+': 'thermal' }} />
    <C2 at="26.5 19.8 90deg" thermal={{ 1: 'solid' }} />
    <C1 at="29 19.8 90deg" thermal={{ 1: 'solid' }} />
    <U1 at="32.5 21 90deg" thermal={{ PGND: 'solid' }} />
    <C4 at="35.4 17.2 90deg" />
    <L1 at="43 24 270deg" />
    <C5 at="45 34 90deg" thermal={{ 1: 'solid' }} />
    <C6 at="47.6 34 90deg" thermal={{ 1: 'solid' }} />
    <C7 at="54 27.4 270deg" thermal={{ '+': 'thermal' }} />
    <J2 at="59 22 90deg" thermal={{ 1: 'thermal' }} />
    <R2 at="32.5 26 90deg" />
    <R1 at="34.8 28" />
    <C8 at="34.8 30" />
    <D2 at="34 36" />
    <R3 at="37.5 36" />
    {HOLES.map(([x, y], i) => (
      <Hole ref={`H${i + 1}`} at={[x, y]} />
    ))}

    {/* input path, 1.2 A at most: 2 mm tracks */}
    {route(J1[1]).X(F1[1]).width(2)}
    {route(F1[2]).Z(D1.A).width(2)}
    {/* switch node: short and wide, a track rather than a pour */}
    {route(U1.SW).H(41).Z(L1[1]).width(1.2)}
    {route(C4[2]).X(L1[1]).width(0.5)}
    {/* boot strap and feedback */}
    {route(U1.BOOT).V(18).Z(C4[1]).width(0.25)}
    {route(U1.FB).X(R2[2]).width(0.25)}
    {route(R2[2]).X(R1[1]).width(0.25)}
    {route(R1[1]).X(C8[1]).width(0.25)}
    {route(R1[2]).X(C8[2]).width(0.3)}
    {route(C8[2]).X(L1[2]).width(0.5)}
    {route(R3[1]).Z(D2.A).width(0.3)}
    {route(R3[2]).X(C5[2]).width(0.3)}

    {pour(VIN, 'F.Cu', VIN_POUR, { priority: 2, connect: 'solid' })}
    {pour(VOUT, 'F.Cu', VOUT_POUR, { priority: 2, connect: 'solid' })}
    {pour(GND, 'F.Cu', rect(W, H), { priority: 0 })}
    {pour(GND, 'B.Cu', rect(W, H))}

    {/* ground stitching beside the switching loop and the output caps */}
    {[
      [29.6, 22.6],
      [27.8, 22.6],
      [26, 22.6],
      [31, 23.6],
      [44.6, 36.6],
      [47, 36.6],
      [49.6, 36.6],
      [52, 36],
      [40, 14],
      [44, 14],
      [56, 16],
    ].map(([x, y]) => via(GND, [x, y], { drill: 0.4, size: 0.8 }))}
    {/* and over the rest of the board wherever both GND pours have fill, 4 mm apart */}
    {stitch(GND, { pitch: 4, layers: ['F.Cu', 'B.Cu'], padClearance: 1.0, via: { drill: 0.4, size: 0.8 }, avoid: { silk: true } })}

    {HOLES.map(([x, y]) => keepout('all', circle(6.4, x, y), { pours: false }))}

    <text layer="F.SilkS" at="14 27.6" size={1.2}>
      24V IN
    </text>
    <text layer="F.SilkS" at="57 11" size={1.2}>
      5V 5A
    </text>
    <text layer="F.SilkS" at="25 40" size={1}>
      PSU 0.1.0
    </text>
    <Brand at="45.9 33" height={4} layer="B.SilkS" />
  </PCB>
)
