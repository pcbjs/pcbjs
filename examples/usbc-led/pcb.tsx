// usbc-led: USB-C 5 V in, AP2112K 3.3 V LDO, power LEDs on 5 V and 3.3 V, a 4-pin header breaking out 3.3 V and GND.
// Frame: millimetres, origin at the top-left corner of the outline, x right, y down. The USB-C mouth sits on the top edge.
import PCB from '@pcbjs/fab/JLCPCB/2-Layer'
import { nets, route, pour, NC } from '@pcbjs/core'
import { Brand, PinHeader, R0603, C0603, LED0603, roundedRect, rect } from '@pcbjs/lib'
import { USBC6P } from './lib/USBC6P'
import { SOT23_5 } from './lib/SOT23_5'
import { MountingHole } from './lib/MountingHole'

const W = 25
const H = 20

// Nets
const { GND, VBUS, V3V3, CC1, CC2, LED5, LED3 } = nets()

// Parts
const J1 = USBC6P().source({ MPN: 'TYPE-C-31-M-17', 'MPN:LCSC': 'C283540' }).connect({ GND, VBUS, CC1, CC2, SH: GND })
const R1 = R0603('5.1k').source({ MPN: '0603WAF5101T5E', 'MPN:LCSC': 'C23186' }).connect(CC1, GND)
const R2 = R0603('5.1k').source({ MPN: '0603WAF5101T5E', 'MPN:LCSC': 'C23186' }).connect(CC2, GND)
const U1 = SOT23_5('AP2112K-3.3').source({ MPN: 'AP2112K-3.3TRG1', 'MPN:LCSC': 'C51118' }).connect({ VIN: VBUS, GND, EN: VBUS, NC, VOUT: V3V3 })
const C1 = C0603('1u').source({ MPN: 'CL10A105KB8NNNC', 'MPN:LCSC': 'C15849' }).connect(VBUS, GND)
const C2 = C0603('1u').source({ MPN: 'CL10A105KB8NNNC', 'MPN:LCSC': 'C15849' }).connect(V3V3, GND)
const R3 = R0603('1k').source({ MPN: '0603WAF1001T5E', 'MPN:LCSC': 'C21190' }).connect(VBUS, LED5)
const D1 = LED0603('red').source({ MPN: 'KT-0603R', 'MPN:LCSC': 'C2286' }).connect({ A: LED5, K: GND })
const R4 = R0603('1k').source({ MPN: '0603WAF1001T5E', 'MPN:LCSC': 'C21190' }).connect(V3V3, LED3)
const D2 = LED0603('green').source({ MPN: 'KT-0603G', 'MPN:LCSC': 'C72043' }).connect({ A: LED3, K: GND })
const J2 = PinHeader(4).source({ MPN: 'PZ254V-11-04P', 'MPN:LCSC': 'C492403' }).connect(V3V3, GND, NC, NC)

export default (
  <PCB name="usbc-led" revision="0.1.0">
    {/* outline: 25 x 20 mm, 1 mm corners */}
    <path layer="Edge.Cuts" d={roundedRect(W, H, 1)} />

    {/* mounting holes, M2, one per corner */}
    <MountingHole ref="H1" at="2.5 2.5" />
    <MountingHole ref="H2" at="22.5 2.5" />
    <MountingHole ref="H3" at="2.5 17.5" />
    <MountingHole ref="H4" at="22.5 17.5" />

    {/* power in: USB-C on the top edge, CC pull-downs just below its pads */}
    <J1 at="12.5 3.65" />
    {/* GND and VBUS sit 0.15 mm apart at each end of the row, too close for a mask dam: one gang opening per pair */}
    <rect layer="F.Mask" x={9.45} y={6.95} w={1.95} h={1.4} fill />
    <rect layer="F.Mask" x={13.6} y={6.95} w={1.95} h={1.4} fill />
    <R1 at="11.6 10.8 270deg" />
    <R2 at="13.4 10.8 270deg" />

    {/* 3.3 V regulator with its input and output caps */}
    <U1 at="12.5 14.5" />
    <C1 at="9 15 270deg" />
    <C2 at="16 15 270deg" />

    {/* indicators: red on 5 V, green on 3.3 V, left column */}
    <R3 at="5 6.5" />
    <D1 at="5 8.6" />
    <R4 at="5 10.9" />
    <D2 at="5 13" />

    {/* breakout: 1 3V3, 2 GND, 3 and 4 spare */}
    <J2 at="21.5 6" />

    {/* routes: VBUS by hand from the USB-C pad down to the LDO input, the rest autorouted */}
    {route(J1.VBUS, C1[1], 'V 8.8 H 9 Z').width(0.4)}
    {route('J1.A9', 'J1.B4', 'V 8.8 @B.Cu H 14 @F.Cu Z').width(0.4)}
    {route(U1.VIN, C1[1]).width(0.4)}
    {route(U1.VIN, U1.EN).width(0.25).direct()}  {/* pin to pin, so the GND pin between them keeps its pour */}
    {route(J1.VBUS, R3[1]).width(0.3)}
    {route(R3[2], D1.A).width(0.25)}
    {route(U1.VOUT, C2[1]).width(0.4)}
    {route(C2[1], J2[1]).width(0.4)}
    {route(J2[1], R4[1]).width(0.3)}
    {route(R4[2], D2.A).width(0.25)}
    {route(J1.CC1, R1[1]).width(0.25)}
    {route(J1.CC2, R2[1]).width(0.25)}

    {/* ground: pours on both layers */}
    {/* laid out for solid pours: the regulator's ground pin sits inside a VBUS loop and would starve a thermal relief */}
    {pour(GND, 'F.Cu', rect(W, H), { connect: 'solid' })}
    {pour(GND, 'B.Cu', rect(W, H), { connect: 'solid' })}

    {/* silk */}
    <text layer="F.SilkS" at="18.9 6" size={0.7}>3V3</text>
    <text layer="F.SilkS" at="18.9 8.54" size={0.7}>GND</text>
    <text layer="F.SilkS" at="7.6 8.6" size={0.7}>5V</text>
    <text layer="F.SilkS" at="7.6 13" size={0.7}>3V3</text>
    <text layer="F.SilkS" at="12.5 18.6" size={0.8}>usbc-led</text>
    <Brand at="10 13" height={4.5} layer="B.SilkS" />
  </PCB>
)
