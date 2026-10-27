// lvds-camera: a camera link adapter, 60 x 18 mm, JLCPCB four layer. A 30 pin 0.5 mm board to board receptacle for the
// camera module on the left, a 2 x 10 1.27 mm header to the host on the right. Four LVDS data lanes and the LVDS clock run
// across as 100 ohm pairs on F.Cu over the GND plane on In1.Cu, matched to each other in the LANES group. I2C goes through a
// PCA9306 from the host's 3.3 V to the camera's 1.8 V, an AP2112K makes 1.8 V from 3.3 V. In2.Cu is split: 1V8 left, 3V3 right.
// Frame: mm, origin at the top-left corner of the outline, x right, y down.
import PCB from '@pcbjs/fab/JLCPCB/4-Layer'
import { nets, route, pour, via, NC, type Net, type Pos } from '@pcbjs/core'
import { Brand, SOT23, TSSOP, R0402, C0402, rect, roundedRect } from '@pcbjs/lib'
import { DF12 } from './lib/DF12'
import { FTSH } from './lib/FTSH'

const W = 60, H = 18
const SMALL = { drill: 0.2, size: 0.45 }
/** a short straight stub from a pad to a via of its net, the via drops into a plane or carries on on B.Cu */
const tie = (pad: Pos, x: number, y: number, net: Net, w = 0.2) => [route(pad, `${x} ${y}`, 'Z').width(w), via(net, `${x} ${y}`, SMALL)]
const lvds = { class: 'lvds' } as const
const { GND, V3V3, V1V8, SDA_H, SCL_H, SDA_C, SCL_C, RST, EN_REF,
  D0P, D0N, D1P, D1N, CKP, CKN, D2P, D2N, D3P, D3N } = nets({
  D0P: lvds, D0N: lvds, D1P: lvds, D1N: lvds, CKP: lvds, CKN: lvds, D2P: lvds, D2N: lvds, D3P: lvds, D3N: lvds,
})

// camera side: even row carries the lanes with a ground between pairs, odd row power, I2C and reset
const J1 = DF12('DF12(3.0)-30DS-0.5V(86)').source({ MPN: 'DF12(3.0)-30DS-0.5V(86)' }).connect({
  1: GND, 3: V1V8, 5: V1V8, 7: GND, 9: SDA_C, 11: SCL_C, 13: RST, 15: GND, 17: NC, 19: NC, 21: GND, 23: NC, 25: NC, 27: NC, 29: GND,
  2: GND, 4: D0P, 6: D0N, 8: GND, 10: D1P, 12: D1N, 14: GND, 16: CKP, 18: CKN, 20: GND, 22: D2P, 24: D2N, 26: GND, 28: D3P, 30: D3N,
})
// host side: a 2 x 10 1.27 mm header
const J2 = FTSH('FTSH-110-01-L-DV').source({ MPN: 'FTSH-110-01-L-DV' }).connect({
  19: D0P, 17: D0N, 15: D1P, 13: D1N, 11: CKP, 9: CKN, 7: D2P, 5: D2N, 3: D3P, 1: D3N,
  2: GND, 4: V3V3, 6: V3V3, 8: GND, 10: SDA_H, 12: SCL_H, 14: RST, 16: GND, 18: GND, 20: GND,
})
// 1.8 V regulator
const U1 = SOT23(5, { pinNames: ['VIN', 'GND', 'EN', 'NC', 'VOUT'] })('AP2112K-1.8TRG1').source({ MPN: 'AP2112K-1.8TRG1' })
  .connect({ VIN: V3V3, GND, EN: V3V3, VOUT: V1V8 })
const C1 = C0402('1u').source({ MPN: 'GRM155R61A105KE15D' }).connect(V3V3, GND)
const C2 = C0402('1u').source({ MPN: 'GRM155R61A105KE15D' }).connect(V1V8, GND)
// I2C level translator, PCA9306DP in TSSOP-8: 1 GND, 2 VREF1, 3 SCL1, 4 SDA1, 5 SDA2, 6 SCL2, 7 VREF2, 8 EN
const U2 = TSSOP(8, { pinNames: ['GND', 'VREF1', 'SCL1', 'SDA1', 'SDA2', 'SCL2', 'VREF2', 'EN'] })('PCA9306DP').source({ MPN: 'PCA9306DP,118' })
  .connect({ GND, VREF1: V1V8, SCL1: SCL_C, SDA1: SDA_C, SDA2: SDA_H, SCL2: SCL_H, VREF2: EN_REF, EN: EN_REF })
const R1 = R0402('200k').connect(V3V3, EN_REF)
const R2 = R0402('2.2k').connect(V1V8, SDA_C)
const R3 = R0402('2.2k').connect(V1V8, SCL_C)
const R4 = R0402('10k').connect(V1V8, RST)

export default (
  <PCB name="lvds-camera" revision="0.1.0" classes={{ lvds: { impedance: 100, skew: 0.1, tolerance: 0.2, via: { drill: 0.2, size: 0.45 } } }}>
    <path layer="Edge.Cuts" d={roundedRect(W, H, 1)} />
    <J1 at="4.5 9 90deg" />
    <J2 at="54.5 9 -90deg" />
    <U1 at="30 3.2 180deg" />
    <C1 at="34.5 3.2" />
    <C2 at="25.5 3.2" />
    <U2 at="30 11.5" />
    <R1 at="35.4 9.35 -90deg" />
    <R2 at="22 11.3" />
    <R3 at="22 12.6" />
    <R4 at="22 13.9" />

    {/* the lanes: pairs with array ends, the path is the centre line. D3 and D2 run over the top of the translator, the clock
        drops to B.Cu under it through two via pairs, D1 and D0 take the bottom channel. All five are in the LANES match group:
        the router meanders the centre lines of the shorter pairs until the group closes. */}
    {route([J1.pad('4'), J1.pad('6')], [J2.pad('19'), J2.pad('17')], 'h 1.2 L 12.45 16.6 H 44.6 V 14.085 Z').match('LANES')}
    {route([J1.pad('10'), J1.pad('12')], [J2.pad('15'), J2.pad('13')], 'h 1.2 L 12.45 15.1 H 41.5 L 45.055 11.545 Z').match('LANES')}
    {route([J1.pad('16'), J1.pad('18')], [J2.pad('11'), J2.pad('9')], 'h 1.2 H 20 @B.Cu L 22 10.75 H 36 L 38 8.75 @F.Cu H 46 L 46.255 9.005 Z').match('LANES')}
    {route([J1.pad('22'), J1.pad('24')], [J2.pad('7'), J2.pad('5')], 'h 1.2 H 48 V 6.465 Z').match('LANES')}
    {route([J1.pad('28'), J1.pad('30')], [J2.pad('3'), J2.pad('1')], 'h 1.2 H 46 L 47.825 3.925 Z').match('LANES')}

    {/* J1 odd row: stubs out to vias staggered under the body and beside the edge */}
    {tie(J1.pad('1'), 3.8, 12.5, GND)}
    {tie(J1.pad('3'), 1.5, 12.0, V1V8)}
    {tie(J1.pad('5'), 3.8, 11.5, V1V8)}
    {tie(J1.pad('7'), 1.5, 11.0, GND)}
    {tie(J1.pad('15'), 1.5, 9.0, GND)}
    {tie(J1.pad('21'), 3.8, 7.5, GND)}
    {tie(J1.pad('29'), 3.8, 5.5, GND)}
    {/* J1 even row grounds between the pairs: vias under the body */}
    {['2', '8', '14', '20', '26'].map(p => tie(J1.pad(p), 5.2, 12.5 - 1.5 * ['2', '8', '14', '20', '26'].indexOf(p), GND))}
    {/* J2 even row: power and grounds to vias beside the pads */}
    {(['2', '8', '16', '18', '20'] as const).map(p => tie(J2.pad(p), 58.4, [3.29, 7.1, 12.18, 13.45, 14.72][['2', '8', '16', '18', '20'].indexOf(p)], GND))}
    {tie(J2.pad('4'), 58.4, 4.56, V3V3, 0.3)}
    {tie(J2.pad('6'), 58.4, 5.83, V3V3, 0.3)}

    {/* I2C and reset on B.Cu */}
    {route(J1.pad('9'), U2.SDA1, 'H 3.8 @B.Cu XZ').width(0.2)}
    {route(J1.pad('11'), U2.SCL1, 'H 1.5 @B.Cu XZ').width(0.2)}
    {route(J1.pad('13'), J2.pad('14'), 'H 3.8 @B.Cu X 58.4 10.91 @F.Cu Z').width(0.2)}
    {route(J2.pad('10'), U2.SDA2, 'H 58.4 @B.Cu XZ').width(0.2)}
    {route(J2.pad('12'), U2.SCL2, 'H 58.4 @B.Cu XZ').width(0.2)}
    {route(R2[2], U2.SDA1).width(0.2)}
    {route(R3[2], U2.SCL1).width(0.2)}
    {route(R4[2], J1.pad('13')).width(0.2)}
    {route(U2.EN, U2.VREF2, 'Z').width(0.2)}
    {route(R1[2], U2.VREF2).width(0.2)}

    {/* power: the regulator and its capacitors, pullups and the translator to the planes */}
    {tie(U1.VIN, 32.6, 4.15, V3V3, 0.3)}
    {tie(U1.EN, 32.6, 2.25, V3V3, 0.3)}
    {tie(U1.GND, 33.2, 3.2, GND, 0.3)}
    {tie(U1.VOUT, 27.4, 4.15, V1V8, 0.3)}
    {route(C1[1], U1.VIN).width(0.3)}
    {route(C1[2], '35.6 3.2', 'Z').width(0.3)}{via(GND, '35.6 3.2', SMALL)}
    {route(C2[1], '24.4 3.2', 'Z').width(0.3)}{via(V1V8, '24.4 3.2', SMALL)}
    {route(C2[2], U1.GND).width(0.3)}
    {tie(U2.GND, 25.6, 9.6, GND)}
    {/* VREF1 steps left before it drops, its via sits below the clock pair that runs on B.Cu under the translator */}
    {route(U2.VREF1, "25.6 12.1", "H 25.6 Z").width(0.2)}{via(V1V8, "25.6 12.1", SMALL)}
    {tie(R2[1], 20.6, 11.3, V1V8)}
    {tie(R3[1], 20.6, 12.6, V1V8)}
    {tie(R4[1], 20.6, 13.9, V1V8)}
    {tie(R1[1], 35.4, 8.1, V3V3)}

    {pour(GND, 'In1.Cu', rect(W, H))}
    {pour(V1V8, 'In2.Cu', rect(30, H))}
    {pour(V3V3, 'In2.Cu', rect(29.5, H, 30.5, 0))}

    <text layer="F.SilkS" at="41 1.4" size={0.8}>lvds-camera rev 0.1.0</text>
    <text layer="F.SilkS" at="4.5 16" size={0.8}>CAM</text>
    <text layer="F.SilkS" at="55 16.9" size={0.8}>HOST</text>
    <Brand at="15.2 3.5" height={4.5} />
  </PCB>
)
