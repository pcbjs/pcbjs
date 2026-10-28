// Hello: a green LED on a 20 x 15 mm two-layer board, powered from a two-pin header.
// Frame: millimetres, origin at the top-left corner of the outline, x right, y down.
import PCB from '@pcbjs/fab/JLCPCB/2-Layer' // the fab: stackup, rules and LCSC sourcing; swap for another preset such as @pcbjs/fab/OSHPark/2-Layer
import { nets, route } from '@pcbjs/core'
import { PinHeader, R0603, LED0603, roundedRect } from '@pcbjs/lib'

// Nets: one name per net.
const { GND, VCC, LED } = nets()

// Parts: the value, the part numbers, then one net per pin in pin order. MPN is the catch-all, MPN:LCSC is what JLCPCB assembles.
const J1 = PinHeader(2).source({ MPN: 'PEC02SAAN' }).connect(GND, VCC)
const R1 = R0603('330').source({ MPN: 'RC0603FR-07330RL', 'MPN:LCSC': 'C23138' }).connect(VCC, LED)
const D1 = LED0603('green').source({ MPN: 'LTST-C190GKT' }).connect({ A: LED, K: GND })

export default (
  <PCB name="Hello" revision="0.1.0">
    {/* outline: 20 x 15 mm with 1 mm corners */}
    <path layer="Edge.Cuts" d={roundedRect(20, 15, 1)} />

    {/* power in: pin 1 GND, pin 2 VCC */}
    <J1 at="3 4.96" />

    {/* the LED and its resistor, in line with J1 pin 2; D1 turned so its anode faces R1 */}
    <R1 at="9 7.5" />
    <D1 at="15 7.5 180deg" />

    {/* routes: Z draws a straight track by hand, XZ leaves the way to the autorouter */}
    {route(J1[2]).Z(R1[1]).width(0.3)}
    {route(R1[2]).Z(D1.A).width(0.3)}
    {route(D1.K).X(J1[1]).width(0.3)}

    {/* silk */}
    <text layer="F.SilkS" at="10 12" size={1}>
      Hello
    </text>
  </PCB>
)
