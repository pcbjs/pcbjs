// PowerModule: the library's regulator on a 22 x 16 mm board, fed and tapped through a three pin header that mates with a carrier.
// Frame: millimetres, origin at the top-left corner of the outline, x right, y down.
import PCB from '@pcbjs/fab/JLCPCB/2-Layer'
import { nets, route } from '@pcbjs/core'
import { PinHeader, roundedRect } from '@pcbjs/lib'
import { schematic as ldo, layout as LdoBlock } from './ldo'

const { VIN, '3V3': _3V3, GND } = nets()

// the header a carrier takes: pin 1 VIN, pin 2 GND, pin 3 the regulated 3.3 V
const J1 = PinHeader(3)().source({ MPN: 'PZ254V-11-03P' }).connect({ 1: VIN, 2: GND, 3: _3V3 })
const PWR = ldo({ VIN, VOUT: _3V3, GND }, 1)

export default (
  <PCB name="PowerModule" rev="0.1.0">
    <path layer="Edge.Cuts" d={roundedRect(22, 16, 1)} />
    <J1 at="3 5.46" />
    <LdoBlock g={PWR} at="14 7" />
    {route(J1[1], PWR.C01[1]).width(0.5)}
    {route(J1[2], PWR.C01[2]).width(0.5)}
    {route(J1[3], PWR.C02[1]).width(0.5)}
    <text layer="F.SilkS" at="14 14 -90" size={1}>
      3V3
    </text>
  </PCB>
)
