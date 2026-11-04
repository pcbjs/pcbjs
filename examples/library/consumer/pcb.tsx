// Carrier: a board built from the power library. It places a regulator of its own from the library's circuit and layout, and takes
// the library's PowerModule board on a three pin socket, its prebuilt reference read from the package with no compile.
// Frame: millimetres, origin at the top-left corner of the outline, x right, y down.
import PCB from '@pcbjs/fab/JLCPCB/2-Layer'
import { nets, reference, route } from '@pcbjs/core'
import { LED0603, PinHeader, R0603, roundedRect } from '@pcbjs/lib'
import { schematic as ldo, layout as LdoBlock } from '@pcbjs-examples/power/ldo'

const { VIN, '3V3': V3V3, V3AUX, GND, LED1, LED2 } = nets()

// power in, and the socket the module stands on, wired as its header: VIN, GND, 3.3 V
const J1 = PinHeader(2)().source({ MPN: 'PZ254V-11-02P' }).connect({ 1: GND, 2: VIN })
const J2 = PinHeader(3)().source({ MPN: 'PZ254V-11-03P' }).connect({ 1: VIN, 2: GND, 3: V3V3 })
// the carrier's own regulator, instance 2 of the library's circuit: U201, C201, C202
const AUX = ldo({ VIN, VOUT: V3AUX, GND }, 2)
// one LED on each 3.3 V rail: the module's through J2, the carrier's own
const R1 = R0603('330').source({ MPN: 'RC0603FR-07330RL' }).connect({ 1: V3V3, 2: LED1 })
const D1 = LED0603('green').source({ MPN: 'LTST-C190GKT' }).connect({ A: LED1, K: GND })
const R2 = R0603('330').source({ MPN: 'RC0603FR-07330RL' }).connect({ 1: V3AUX, 2: LED2 })
const D2 = LED0603('green').source({ MPN: 'LTST-C190GKT' }).connect({ A: LED2, K: GND })

export default (
  <PCB name="Carrier" rev="0.1.0">
    <path layer="Edge.Cuts" d={roundedRect(40, 30, 1.5)} />
    <J1 at="3 4.96" />
    <J2 at="12 20.46" />
    <LdoBlock g={AUX} at="28 9" />
    <R1 at="20 18" />
    <D1 at="20 22 90deg" />
    <R2 at="28 22" />
    <D2 at="34 22 180deg" />
    {route(J1[2], J2[1]).width(0.5)}
    {route(J1[1], J2[2]).width(0.5)}
    {route(J2[1], AUX.C01[1]).width(0.5)}
    {route(J2[2], AUX.C01[2]).width(0.5)}
    {route(J2[3], R1[1]).width(0.3)}
    {route(R1[2], D1.A).width(0.3)}
    {route(D1.K, J2[2]).width(0.3)}
    {route(AUX.C02[1], R2[1]).width(0.3)}
    {route(R2[2], D2.A).width(0.3)}
    {route(D2.K, AUX.C02[2]).width(0.3)}

    {/* the module stands on J2, pin for pin, its nets checked against these */}
    {reference('@pcbjs-examples/power/boards/PowerModule', { mate: { local: J2, remote: 'J1', pin: 1, nets: true } })}

    <text layer="F.SilkS" at="20 27" size={1}>
      Carrier
    </text>
  </PCB>
)
