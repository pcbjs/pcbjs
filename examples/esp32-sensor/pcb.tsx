// ESP32 sensor node: ESP32-C3-MINI-1, USB-C with ESD, 3.3 V LDO, BME280, reset and boot buttons, status LED and debug header on a 40 x 30 mm two-layer board.
// Frame: millimetres, origin at the top-left corner of the outline, x right, y down. The module antenna overhangs nothing but owns the top-right corner, so both pours stop short of it.
import PCB from '@pcbjs/fab/JLCPCB/2-Layer'
import { route, pour, via } from '@pcbjs/core'
import { Brand, roundedRect } from '@pcbjs/lib'
import * as sch from './esp32-sensor.sch'
import './esp32-sensor.sourcing'
import { LdoRow } from './lib/ldo.layout'
import { Bme280Block } from './lib/bme280.layout'

const W = 40, H = 30
// the pour outline: the whole board but the antenna corner above the module's pads
const POUR = `M 0 0 H 23 V 6.6 H ${W} V ${H} H 0 Z`

export default (
  <PCB name="esp32-sensor" revision="0.1.0" schematic={sch} rules={{ strictNets: true, requireSourcing: true }}
    // both layers for every automatic leg, and the router kept out of the antenna corner
    autoroute={{ layers: ["F.Cu", "B.Cu"], avoid: [{ x: 23, y: 0, w: 17, h: 6.6 }] }}>
    <path layer="Edge.Cuts" d={roundedRect(W, H, 1.5)} />

    {/* the module in the top-right, antenna at the top edge */}
    <U1 at="30 9.5" />
    <C1 at="21.3 7.3 180deg" />
    <C2 at="21.3 9.1 180deg" />

    {/* debug header along the top-left edge: 3V3 GND TX RX EN BOOT from the left */}
    <J2 at="3.5 2.5 90deg" />

    {/* power: USB-C on the bottom edge, its ESD and CC resistors above it, the LDO row above those */}
    <J1 at="8 22.7" />
    <R1 at="4.5 19.5 90deg" />
    <R2 at="12 19.5 90deg" />
    <U2 at="8.5 17" />
    <LdoRow g={LDO} at="9 8.5" />

    {/* reset and boot */}
    <R3 at="21.3 12.4 180deg" />
    <C3 at="21.3 14.2" />
    <SW1 at="16 14" />
    <SW2 at="17 25" />

    {/* status LED under the module */}
    <R4 at="27 21.5" />
    <D1 at="30.5 21.5 180deg" />

    {/* sensor in the bottom-right corner, away from the module */}
    <Bme280Block g={SENS} at="35 26" />

    {/* power, by hand: VBUS straight up the left to the LDO, 3V3 along y = 10.6 to the module's decoupling and pin 3 */}
    {route('J1.A4', LDO.CIN[1], 'Z').width(0.4)}
    {route(LDO.COUT[1], C2[1], 'V 10.6 H 22.125 Z').width(0.4)}
    {route(C1[1], C2[1], 'Z').width(0.4)}
    {route(C2[1], U1['3V3'], 'Z').width(0.4)}

    {/* GND: vias in the module's centre pads into the back pour */}
    {[[29.2, 11.2], [30.8, 11.2], [29.2, 12.8], [30.8, 12.8], [27.6, 9.6]].map(([x, y]) => via(GND, [x, y]))}
    {/* stitching vias for three F.Cu GND pieces the tracks fence off: under U2, beside SW1.3, below U1.14 */}
    {[[8.5, 17], [9.82, 14.9], [26, 18.55]].map(([x, y]) => via(GND, [x, y], { drill: 0.2, size: 0.45 }))}

    {/* USB data: DN joined under the pad row, DP joined across the ESD, through the ESD, round the module to IO18 and IO19 */}
    {route('J1.B7', 'J1.A7', 'V 23.65 H 8.25 Z').width(0.2)}
    {route(U2[3], U2[4], 'Z').width(0.2)}
    {route(U2[1], U2[6], 'Z').width(0.2)}
    {route('J1.A6', U2[3]).width(0.2)}
    {route('J1.B6', U2[4]).width(0.2)}
    {route('J1.A7', U2[1]).width(0.2)}
    {route(U2[4], U1.IO19).width(0.2)}
    {route(U2[6], U1.IO18).width(0.2)}
    {route('J1.A5', R1[1]).width(0.2)}
    {route('J1.B5', R2[1]).width(0.2)}

    {/* the second VBUS pad and the ESD's VBUS pin, routed after the data pair so they cannot wall it off */}
    {route('J1.B4', U2[5]).width(0.3)}
    {route(U2[5], LDO.CIN[1]).width(0.3)}

    {/* 3V3 to the rest, autorouted */}
    {route(C2[1], R3[1]).width(0.3)}
    {route(U1['3V3'], J2[1]).width(0.3)}
    {route(R3[1], R4[1]).width(0.3)}
    {route(R4[1], D1.A).width(0.3)}
    {route(D1.A, SENS.C[1]).width(0.3)}

    {/* EN, BOOT, LED, UART and I2C, autorouted */}
    {route(U1.EN, R3[2]).width(0.2)}
    {route(R3[2], C3[1]).width(0.2)}
    {route(C3[1], SW1.A).width(0.2)}
    {route(J2[5], SW1.A).width(0.2)}
    {route(U1.IO9, SW2.A).width(0.2)}
    {route(SW2.A, J2[6]).width(0.2)}
    {/* each switch has two pads per side, joined inside the part but not on the board */}
    {route('SW1.1', 'SW1.2', 'Z').width(0.2)}
    {route('SW2.1', 'SW2.2', 'Z').width(0.2)}
    {route(U1.IO8, R4[2]).width(0.2)}
    {route(R4[2], D1.K).width(0.2)}
    {/* the header ends are given on B.Cu: a route reaching a through-hole pad from the back otherwise drops a via into its hole */}
    {route(U1.TXD0, '8.58 2.5 B.Cu').width(0.2)}
    {route(U1.RXD0, '11.12 2.5 B.Cu').width(0.2)}
    {route(U1.IO4, SENS.RSDA[2]).width(0.2)}
    {route(U1.IO5, SENS.RSCL[2]).width(0.2)}

    {/* pours */}
    {/* laid out for solid pours: the module's ground pads and the dense parts would starve thermal reliefs */}
    {pour(GND, 'F.Cu', POUR, { connect: 'solid' })}
    {pour(GND, 'B.Cu', POUR, { connect: 'solid' })}

    {/* silk */}
    <text layer="F.SilkS" at="9.85 4.6" size={0.7}>3V3 GND TX RX EN IO9</text>
    <text layer="F.SilkS" at="16 17.6" size={0.8}>RST</text>
    <text layer="F.SilkS" at="17 28.6" size={0.8}>BOOT</text>
    <text layer="F.SilkS" at="35 22.6" size={0.8}>BME280</text>
    <text layer="B.SilkS" at="20 27.5" size={1.2}>{'esp32-sensor rev 0.1.0\npcbjs'}</text>
    <Brand at="20 22.75" height={4} layer="B.SilkS" />
  </PCB>
)
