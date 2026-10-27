// highspeed: a USB-C to 4-pin USB 2.0 header adapter with an ESD array, and a four line data bus between two headers whose
// lines are length matched, 44 x 24 mm, four layers: signals on F.Cu and B.Cu, GND on In1.Cu, VBUS on In2.Cu. D+ and D- run
// as 90 ohm differential pairs: by hand from the receptacle into the ESD array, then through a via pair on B.Cu down to the
// header. docs/pairs.md explains the pair routes, docs/routing.md the length matching.
// Frame: millimetres, origin at the top-left corner of the outline, x right, y down. The USB-C mouth sits on the top edge.
import PCB from '@pcbjs/fab/JLCPCB/4-Layer'
import { nets, route, pour, via, NC } from '@pcbjs/core'
import { Brand, USBC, SOT23, R0603, PinHeader, rect, roundedRect } from '@pcbjs/lib'

const W = 44, H = 24

const { GND, VBUS, CC1, CC2, DP, DN, D0, D1, D2, D3 } = nets({ DP: { class: 'usb' }, DN: { class: 'usb' } })

// KiCad library models for the 3D view, see models/LICENSE.md; paths are relative to this file, and the generated model
// shows until a mesh arrives. KiCad has no model of the HRO receptacle, so J1 shows the GCT USB4105 on the same land pattern.
const USB_MODEL = { step: './models/USB_C_Receptacle_GCT_USB4105-xx-A_16P_TopMnt_Horizontal.step' }
const R_MODEL = { step: './models/R_0603_1608Metric.step' }
const HEADER_MODEL = { step: './models/PinHeader_1x04_P2.54mm_Vertical.step' }

const J1 = USBC('full16', { value: 'TYPE-C-31-M-12', model: USB_MODEL }).connect({ GND, VBUS, CC1, CC2, DP, DN, SBU1: NC, SBU2: NC, SHIELD: GND })
const R1 = R0603({ value: '5.1k', model: R_MODEL }).connect(CC1, GND)
const R2 = R0603({ value: '5.1k', model: R_MODEL }).connect(CC2, GND)
// USBLC6-2SC6: I/O 1 on pins 1 and 6, I/O 2 on pins 3 and 4, flow through
const U1 = SOT23(6, { pinNames: { 1: 'IO1', 6: 'IO1', 3: 'IO2', 4: 'IO2', 2: 'GND', 5: 'VBUS' } })('USBLC6-2SC6').connect({ IO1: DP, IO2: DN, GND, VBUS })
const J2 = PinHeader(4, { model: HEADER_MODEL }).connect(VBUS, DN, DP, GND)
// the data bus: a column header and a row header, so the lines turn a corner and the inner ones start shorter
const J3 = PinHeader(4, { model: HEADER_MODEL }).connect(D0, D1, D2, D3)
const J4 = PinHeader(4, { model: HEADER_MODEL }).connect(D0, D1, D2, D3)
const SMALL = { drill: 0.2, size: 0.45 }
// the ground vias of the CC pull-downs, each the end of the route from its resistor
const RV1 = via(GND, '18.6 10', SMALL), RV2 = via(GND, '5.4 10', SMALL)

export default (
  // the usb class: a 0.15 mm gap, which .impedance(90) holds while it solves the width, 0.1 mm of skew, small vias, and room
  // for the long fans into the 2.54 mm header
  <PCB name="highspeed" revision="0.1.0" classes={{ usb: { gap: 0.15, skew: 0.1, uncoupled: 8, via: { drill: 0.2, size: 0.45 } } }}>
    <path layer="Edge.Cuts" d={roundedRect(W, H, 1)} />
    <J1 at="12 3.4 180deg" />
    <U1 at="12.5 14 90deg" />
    <J2 at="16.31 21 -90deg" />
    <R1 at="17 10" />
    <R2 at="7 10 180deg" />
    <J3 at="27 4" />
    <J4 at="38.62 21 -90deg" />

    {/* the pair from the B6 and A7 contacts down into the ESD array, drawn by hand: the path is its centre line */}
    {route([J1.B6, J1.A7]).V(9.4).L(12.5, 10.4).Z([U1.pad('6'), U1.pad('4')]).impedance(90)}
    {/* through the ESD array: I/O 1 from pin 6 to pin 1, I/O 2 from pin 4 to pin 3, straight under the package */}
    {route(U1.pad('6')).Z(U1.pad('1')).width(0.27)}
    {route(U1.pad('4')).Z(U1.pad('3')).width(0.27)}
    {/* the pair from the ESD array to the header: down through a via pair to B.Cu and back, the last hop autorouted */}
    {route([U1.pad('1'), U1.pad('3')]).V(17.2).via('B.Cu').V(18.5).via('F.Cu').X([J2[3], J2[2]]).impedance(90)}

    {/* the A6 and B7 contacts join their nets on B.Cu under the receptacle: a stub up from each pad to a via, a link between */}
    {(function* () {
      const { B6, A6, A7, B7 } = J1
      const B6V = via(B6.net, '11.25 6.2', SMALL), A6V = via(A6, '12.25 6.2', SMALL)
      const A7V = via(A7, '11.75 5.4', SMALL), B7V = via(B7, '12.75 5.4', SMALL)
      yield B6V
      yield route(B6).Z(B6V).width(0.2)
      yield A6V
      yield route(A6).Z(A6V).width(0.2)
      yield A7V
      yield route(A7).Z(A7V).width(0.2)
      yield B7V
      yield route(B7).Z(B7V).width(0.2)
      yield route(B6V).layer('B.Cu').Z(A6V).width(0.2)
      yield route(A7V).layer('B.Cu').Z(B7V).width(0.2)
    })()}

    {/* supply and ground: a via below each pad to the GND plane on In1.Cu and the VBUS plane on In2.Cu */}
    {(['B1', 'B4', 'A4', 'A1'] as const).map((pad, i) => {
      const v = via(J1[pad], `${[8.75, 9.55, 14.45, 15.25][i]} 8.75`, SMALL)
      return [route(J1[pad]).Z(v).width(0.3), v]
    })}
    {via(VBUS, '12.5 12.1', SMALL)}
    {via(GND, '12.5 15.9', SMALL)}

    {/* CC pull-downs */}
    {route(J1.CC1).X(R1[1]).width(0.2)}
    {route(J1.CC2).X(R2[1]).width(0.2)}
    {RV1}{route(R1[2]).Z(RV1).width(0.3)}
    {RV2}{route(R2[2]).Z(RV2).width(0.3)}

    {/* the data bus: each line runs across and then down to the row header, and .match() tunes the shorter ones with
        meanders 2 mm high to the longest plus half the tolerance, 0.1 mm; the inner lines have room inside the corner */}
    {[0, 1, 2, 3].map(i => route(J3[i + 1]).H(38.62 - 2.54 * i).Z(J4[i + 1]).width(0.2).match('DATA').rules({ tune: { amplitude: 2 } }))}

    {pour(GND, 'In1.Cu', rect(W, H))}
    {pour(VBUS, 'In2.Cu', rect(W, H))}

    <text layer="F.SilkS" at="5 15" size={0.8}>highspeed</text>
    <text layer="F.SilkS" at="5 16.4" size={0.7}>rev 0.1.0</text>
    {[['GND', 8.69], ['D+', 11.23], ['D-', 13.77], ['VBUS', 16.31]].map(([name, x]) => <text layer="F.SilkS" at={`${x} 22.9`} size={0.6}>{name}</text>)}
    {[0, 1, 2, 3].map(i => <text layer="F.SilkS" at={`${38.62 - 2.54 * i} 22.9`} size={0.6}>{`D${i}`}</text>)}
    <Brand at="33.35 16.5" height={5} layer="B.SilkS" />
  </PCB>
)
