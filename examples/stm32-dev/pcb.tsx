// stm32-dev: an STM32F103C8 dev board, 50 x 35 mm, four layers: signals on F.Cu and B.Cu, GND on In1.Cu, 3V3 on In2.Cu.
// Frame: millimetres, origin at the top-left corner of the outline, x right, y down. The schematic is stm32-dev.sch.ts.
import JLCPCB from '@pcbjs/fab/JLCPCB/4-Layer' // the fab: JLC04161H-7628 stackup, JLCPCB rules, LCSC sourcing
import OSHPark from '@pcbjs/fab/OSHPark/4-Layer'
import { variants, route, pour, via, keepout } from '@pcbjs/core'
import { Brand, rect, roundedRect } from '@pcbjs/lib'
import { gnd, pwr } from './lib/plane'
import './stm32-dev.sourcing'
import * as sch from './stm32-dev.sch'

const PCB = variants(JLCPCB, OSHPark)
const W = 50,
  H = 35
const SIG = 0.2

export default (
  // both targets share one routing under the stricter of the JLCPCB and OSH Park rules, so they get the same copper.
  // autoroute: signals on the outer layers only; a keepout holds the back under the package for the supply capacitors.
  <PCB name="stm32-dev" rev="0.1.0" schematic={sch} autoroute={{ layers: ['F.Cu', 'B.Cu'] }}>
    {/* outline: 50 x 35 mm with 1.5 mm corners */}
    <path layer="Edge.Cuts" d={roundedRect(W, H, 1.5)} />

    {/* GPIO rows on the long edges, pin 1 on the left; the 19 pins span 45.72 mm */}
    <J3 at="2.14 2.2 90deg" />
    <J4 at="2.14 32.8 90deg" />

    {/* the MCU in the middle; its supply capacitors sit on the back under the package, one row per cap, no routed tracks among them */}
    <U1 at="27 17.5" />
    {keepout('M 23.2 14.3 H 30.8 V 20.7 H 23.2 Z', { layers: ['B.Cu'], vias: false, pours: false })}
    <C11 at="25.2 15.3 180deg" side="B" />
    <C10 at="28.6 15.6 180deg" side="B" />
    <C8 at="25.2 17.6" side="B" />
    <C7 at="28.6 17.6 180deg" side="B" />
    <C9 at="28.6 19.6" side="B" />

    {/* clocks: the 32.768 kHz crystal above the 8 MHz one, both left of the package, load caps further left */}
    <LSE.Y1 at="19.5 13.2" />
    <LSE.C1 at="19.5 10.6 180deg" />
    <LSE.C2 at="15.8 13.2 180deg" />
    <HSE.Y1 at="18.2 18.2" />
    <HSE.C1 at="14.2 16 180deg" />
    <HSE.C2 at="14.2 19 180deg" />
    {/* no foreign copper on the back under the crystals and load caps; the 8 MHz nets' own hops to the back may enter */}
    {keepout('M 14.2 9.7 H 21.6 V 15.1 H 20.5 V 19.9 H 12.6 V 15.1 H 14.2 Z', { layers: ['B.Cu'], vias: false, except: [OSC_IN, OSC_OUT] })}

    {/* USB-C on the right edge, mouth out; CC pull-downs beside it; the regulator in the top-right corner */}
    <USB.J1 at="46.4 17.5 -90deg" />
    <USB.R1 at="40 13.6" />
    <USB.R2 at="40 21" />
    <R3 at="35 14.2" />
    <LDO.U1 at="45 8" />
    <LDO.C1 at="47.8 8 90deg" />
    <LDO.C2 at="41.8 8 90deg" />

    {/* left edge: boot button, SWD header, reset button */}
    <SW2 at="2.6 7.6 90deg" />
    <R4 at="6 10.5 90deg" />
    <J2 at="2.5 12.42" ref:at="2.1 8.6 90" />
    <SW1 at="2.6 27.4 90deg" ref:at="-3.5 0 -90" />
    <C12 at="6 27 90deg" />
    <R5 at="25 29.6 90deg" />

    {/* LEDs: power and user, resistors on the left */}
    <R6 at="6.5 14" />
    <D1 at="10 14 180deg" />
    <R7 at="6.5 17" />
    <D2 at="10 17 180deg" />

    {/* hand routes first: the 32.768 kHz crystal straight into PC14 and PC15 */}
    {route(LSE.Y1[2], U1.PC14).width(SIG).V(15.75).Z()}
    {route(LSE.Y1[1], U1.PC15).width(SIG).V(16.25).Z()}
    {route(LSE.C1[1], LSE.Y1[2]).width(SIG).L(20.75, 11.4).Z()}
    {route(LSE.C2[1], LSE.Y1[1]).width(SIG).Z()}
    {/* the 8 MHz crystal: OSC_IN on the top, OSC_OUT dives to the back under the crystal and comes up beside NRST */}
    {route(HSE.Y1.X2, U1.OSC_IN).width(SIG).L(19.95, 16.75).Z()}
    {route(HSE.Y1.X1, U1.OSC_OUT).width(SIG).V(20.2).via('B.Cu').H(20.75).V(17.6).via('F.Cu').L(21.1, 17.25).Z()}
    {route(HSE.C1[1], HSE.Y1.X2).width(SIG).H(16.4).via('B.Cu').L(18.9, 17.4).via('F.Cu').Z()}
    {route(HSE.C2[1], HSE.Y1.X1).width(SIG).Z()}

    {/* USB data: A6 and A7 straight in as a pair, the B-side pads joined by the router */}
    {route(USB.J1.DP1, U1.PA12).width(SIG).H(40.5).L(39.5, 16.25).Z()}
    {route(USB.J1.DN1, U1.PA11).width(SIG).H(37.5).L(36.5, 16.75).Z()}
    {route(USB.J1.DP2, USB.J1.DP1).width(SIG).priority(5)}
    {route(USB.J1.DN2, USB.J1.DN1).width(SIG).priority(5)}
    {route(R3[2], USB.J1.DP1).width(SIG)}
    {route(USB.J1.CC1, USB.R1[1]).width(SIG).priority(4)}
    {route(USB.J1.CC2, USB.R2[1]).width(SIG).priority(4)}
    {route(USB.J1.GND_A, USB.J1.SH1).width(0.4).Z()}
    {route(USB.J1.GND_B, USB.J1.SH2).width(0.4).Z()}

    {/* LED strings */}
    {route(R6[2], D1.A).width(SIG).Z()}
    {route(R7[2], D2.A).width(SIG).Z()}

    {/* power: VBUS from both USB pads to the regulator and the header, 0.4 mm */}
    {route(USB.J1.VBUS_A, LDO.U1.VIN).width(0.4).priority(4)}
    {route(USB.J1.VBUS_B, USB.J1.VBUS_A).width(0.4).priority(4)}
    {route(LDO.U1.VIN, LDO.C1[1]).width(0.4).priority(4)}
    {route(LDO.C1[1], J3[18]).width(0.4).priority(4)}
    {route(SW2[2], J3[2]).width(0.3)}

    {/* supply pins: a via in each back capacitor pad goes to its plane, the pins reach it on the top inside the package outline */}
    {via(V3V3, '24.375 15.3')}
    {via(GND, '26.025 15.3')}
    {via(V3V3, '27.775 15.6')}
    {via(GND, '29.425 15.6')}
    {via(GND, '24.375 17.6')}
    {via(V3V3, '26.025 17.6')}
    {via(V3V3, '27.775 17.6')}
    {via(GND, '29.425 17.6')}
    {via(GND, '27.775 19.6')}
    {via(V3V3, '29.425 19.6')}
    {route(U1.VBAT, '24.375 15.3').width(0.25).priority(4)}
    {route(U1.VDD_3, '24.375 15.3').width(0.25).priority(4)}
    {route(U1.VSS_3, '26.025 15.3').width(0.25).priority(4)}
    {route(U1.VDD_2, '27.775 15.6').width(0.25).priority(4)}
    {route(U1.VSS_2, '29.425 15.6').width(0.25).priority(4)}
    {route(U1.VSSA, '24.375 17.6').width(0.25).priority(4)}
    {route(U1.VDDA, '26.025 17.6').width(0.25).priority(4)}
    {route(U1.VDD_1, '29.425 19.6').width(0.25).priority(4)}
    {route(U1.VSS_1, '27.775 19.6').width(0.25).priority(4)}

    {/* plane vias for the other parts: GND to In1.Cu, 3V3 to In2.Cu */}
    {gnd(HSE.Y1.GND1, 19.3, 21.0)}
    {gnd(HSE.Y1.GND2, 15.9, 17.4)}
    {gnd(HSE.C1[2], 11.9, 16.0)}
    {gnd(HSE.C2[2], 11.9, 19.0)}
    {gnd(LSE.C1[2], 18.675, 9.3)}
    {gnd(LSE.C2[2], 13.7, 13.2)}
    {gnd(USB.R1[2], 40.825, 12.3)}
    {gnd(USB.R2[2], 40.825, 22.3)}
    {pwr(R3[1], 34.175, 12.9)}
    {gnd(LDO.U1.GND, 44.0, 5.9)}
    {pwr(LDO.U1.VOUT, 44.0, 10.2)}
    {gnd(LDO.C1[2], 47.8, 5.9)}
    {gnd(LDO.C2[2], 41.8, 5.9)}
    {pwr(LDO.C2[1], 41.8, 10.1)}
    {gnd(R4[2], 6.0, 8.4)}
    {gnd(SW1[2], 4.3, 25.4)}
    {gnd(C12[2], 6.0, 24.9)}
    {gnd(R5[2], 25.0, 27.5)}
    {gnd(D1.K, 12.0, 14.0)}
    {pwr(R6[1], 5.675, 15.5)}
    {route(R7[1], '5.675 15.5').layers(['F.Cu']).width(0.3)}

    {/* the rest by the router: every GPIO to its header pin first, then SWD, reset and boot, which cross the fan-out */}
    {/* SWD: PA13 and PA14 up to their top header pins on the front, then the SWD header chained from those pins along the top and left edges on the back */}
    {route(U1.PA13, J3[15]).layers(['F.Cu']).width(SIG)}
    {route(U1.PA14, J3[14]).layers(['F.Cu']).width(SIG)}
    {route(J3[15], J2[4]).width(SIG).layer('B.Cu').V(5).H(4.7).V(20.04).Z()}
    {route(J3[14], J2[2]).width(SIG).layer('B.Cu').V(4.4).H(4).V(14.96).Z()}
    {route(U1.NRST, '2.5 22.58 B.Cu').width(SIG).priority(2)}
    {route(SW1[1], J2[5]).layers(['F.Cu']).width(SIG)}
    {route(SW1[1], C12[1]).width(SIG)}
    {route(J2[5], J3[4]).layer('B.Cu').layers(['B.Cu']).width(SIG)}
    {route(U1.BOOT0, R4[1]).width(SIG)}
    {route(R4[1], SW2[1]).width(SIG)}
    {route(D2.K, U1.PC13).width(SIG)}
    {route(R5[1], J4[10]).width(SIG).Z()}
    {TOP_IO.map((p, i) => route(U1[p], J3[[3, 5, 6, 7, 8, 9, 10, 11, 12, 13][i]]).width(SIG).priority(1))}
    {BOTTOM_IO.map((p, i) =>
      route(U1[p], J4[i + 1])
        .width(SIG)
        .priority(1),
    )}

    {/* planes */}
    {pour(GND, 'In1.Cu', rect(W, H))}
    {pour(V3V3, 'In2.Cu', rect(W, H))}

    {/* silk */}
    <text layer="F.SilkS" at="13 24" size={1}>
      stm32-dev
    </text>
    <text layer="F.SilkS" at="13 25.6" size={0.8}>
      rev 0.1.0
    </text>
    <Brand at="39.35 27.5" height={6} />
  </PCB>
)
