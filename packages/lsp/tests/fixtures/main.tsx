// Blinky, the layout: the parts of blinky.sch.ts placed on a 30 x 20 mm two-layer board, and the copper between them.
// Frame: millimetres, origin at the top-left corner of the outline, x right, y down (SVG).
import PCB, { route, pour, via } from '@pcbjs/core'
import { J1, Q1, C1, CH1, CH2, CH3, GND, VCC, SW } from './blinky.sch'
import './blinky.sourcing'
import { LedChannelRow } from './lib/led-channel.layout'

const W = 30, H = 20, R = 2
const outline = `M 0 0 H ${W} V ${H} H 0 Z`

export default (
  <PCB name="Blinky" title="Blinky" revision="0.1.0" copper={2} rules={{ clearance: 0.2, minTrackWidth: 0.2, strictNets: true, requireSourcing: true }} autoroute={{ bend: '45', viaCost: 4 }}>
    {/* outline: rounded rectangle */}
    <path layer="Edge.Cuts" d={`M ${R} 0 H ${W - R} A ${R} ${R} 0 0 1 ${W} ${R} V ${H - R} A ${R} ${R} 0 0 1 ${W - R} ${H} H ${R} A ${R} ${R} 0 0 1 0 ${H - R} V ${R} A ${R} ${R} 0 0 1 ${R} 0 Z`} />

    {/* the connector and the switch, placed by hand */}
    <J1 at="3 7.46" />
    <Q1 at="26 10" />

    {/* the three channels, each placed by the circuit's row layout */}
    <LedChannelRow g={CH1} at="0 5" label="LED1" />
    <LedChannelRow g={CH2} at="0 10" label="LED2" />
    <LedChannelRow g={CH3} at="0 15" label="LED3" />

    {/* the decoupling capacitor on the back */}
    <C1 at="15 10" side="B" />
    <text layer="B.SilkS" at="15 8.3" size={0.8}>C1</text>

    {/* VCC: from J1.2 to a vertical bus feeding the channels, and down to C1 through a via */}
    {route(VCC, { width: 0.3, d: 'M 3 10 H 9 M 9 5 V 15 M 9 11.6 H 15.8' })}
    {via(VCC, '15.8 11.6')}
    {route(VCC, { layer: 'B.Cu', width: 0.3, d: 'M 15.8 11.6 V 10' })}

    {/* SW: LED cathodes to Q1.3 */}
    {route(SW, { width: 0.3, d: 'M 22.2 5 V 16.5 H 27 V 10' })}

    {/* SIG: J1.3 to Q1.1, drawn down and across under the LEDs on the back, the last hop to Q1.1 autorouted */}
    {route(J1[3], Q1[1], 'V 14 L 5 16 @B.Cu H 24 V 7.5 @F.Cu XZ').width(0.25)}

    {/* GND: Q1.2 to a point on the back pour, autorouted all the way; the via comes from the router */}
    {route(Q1[2], '25 12.5 B.Cu').width(0.3)}
    {pour(GND, 'B.Cu', outline)}

    {/* silk */}
    <text layer="F.SilkS" at="3 4.3" size={0.8}>GND</text>
    <text layer="F.SilkS" at="15 18.5" size={1}>Blinky · pcbjs</text>
  </PCB>
)
