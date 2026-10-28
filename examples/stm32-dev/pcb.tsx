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
  <PCB name="stm32-dev" revision="0.1.0" schematic={sch} autoroute={{ layers: ['F.Cu', 'B.Cu'] }}>
    {/* outline: 50 x 35 mm with 1.5 mm corners */}
    <path layer="Edge.Cuts" d={roundedRect(W, H, 1.5)} />

    {/* GPIO rows on the long edges, pin 1 on the left; the 19 pins span 45.72 mm */}
    <J_TOP at="2.14 2.2 90deg" />
    <J_BOT at="2.14 32.8 90deg" />

    {/* the MCU in the middle; its supply capacitors sit on the back under the package, one row per cap, no routed tracks among them */}
    <U1 at="27 17.5" />
    {keepout('B.Cu', 'M 23.2 14.3 H 30.8 V 20.7 H 23.2 Z', { vias: false, pours: false })}
    <C_VDD3 at="25.2 15.3 180deg" side="B" />
    <C_VDD2 at="28.6 15.6 180deg" side="B" />
    <C_VDDA at="25.2 17.6" side="B" />
    <C_VBAT at="28.6 17.6 180deg" side="B" />
    <C_VDD1 at="28.6 19.6" side="B" />

    {/* clocks: the 32.768 kHz crystal above the 8 MHz one, both left of the package, load caps further left */}
    <LSE.Y at="19.5 13.2" />
    <LSE.CIN at="19.5 10.6 180deg" />
    <LSE.COUT at="15.8 13.2 180deg" />
    <HSE.Y at="18.2 18.2" />
    <HSE.CIN at="14.2 16 180deg" />
    <HSE.COUT at="14.2 19 180deg" />
    {/* no foreign copper on the back under the crystals and load caps; the 8 MHz nets' own hops to the back may enter */}
    {keepout('B.Cu', 'M 14.2 9.7 H 21.6 V 15.1 H 20.5 V 19.9 H 12.6 V 15.1 H 14.2 Z', { vias: false, except: [OSC_IN, OSC_OUT] })}

    {/* USB-C on the right edge, mouth out; CC pull-downs beside it; the regulator in the top-right corner */}
    <USB.J at="46.4 17.5 -90deg" />
    <USB.RCC1 at="40 13.6" />
    <USB.RCC2 at="40 21" />
    <R_DP at="35 14.2" />
    <LDO.U at="45 8" />
    <LDO.CIN at="47.8 8 90deg" />
    <LDO.COUT at="41.8 8 90deg" />

    {/* left edge: boot button, SWD header, reset button */}
    <SW_BOOT at="2.6 7.6 90deg" />
    <R_BOOT0 at="6 10.5 90deg" />
    <J_SWD at="2.5 12.42" refAt="2.1 8.6 90" />
    <SW_RST at="2.6 27.4 90deg" refAt="-3.5 0 -90" />
    <C_NRST at="6 27 90deg" />
    <R_BOOT1 at="25 29.6 90deg" />

    {/* LEDs: power and user, resistors on the left */}
    <R_LED1 at="6.5 14" />
    <D_PWR at="10 14 180deg" />
    <R_LED2 at="6.5 17" />
    <D_USR at="10 17 180deg" />

    {/* hand routes first: the 32.768 kHz crystal straight into PC14 and PC15 */}
    {route(LSE.Y[2], U1.PC14, 'V 15.75 Z').width(SIG)}
    {route(LSE.Y[1], U1.PC15, 'V 16.25 Z').width(SIG)}
    {route(LSE.CIN[1], LSE.Y[2], 'L 20.75 11.4 Z').width(SIG)}
    {route(LSE.COUT[1], LSE.Y[1], 'Z').width(SIG)}
    {/* the 8 MHz crystal: OSC_IN on the top, OSC_OUT dives to the back under the crystal and comes up beside NRST */}
    {route(HSE.Y.X2, U1.OSC_IN, 'L 19.95 16.75 Z').width(SIG)}
    {route(HSE.Y.X1, U1.OSC_OUT, 'V 20.2 @B.Cu H 20.75 V 17.6 @F.Cu L 21.1 17.25 Z').width(SIG)}
    {route(HSE.CIN[1], HSE.Y.X2, 'H 16.4 @B.Cu L 18.9 17.4 @F.Cu Z').width(SIG)}
    {route(HSE.COUT[1], HSE.Y.X1, 'Z').width(SIG)}

    {/* USB data: A6 and A7 straight in as a pair, the B-side pads joined by the router */}
    {route(USB.J.DP1, U1.PA12, 'H 40.5 L 39.5 16.25 Z').width(SIG)}
    {route(USB.J.DN1, U1.PA11, 'H 37.5 L 36.5 16.75 Z').width(SIG)}
    {route(USB.J.DP2, USB.J.DP1).width(SIG).priority(5)}
    {route(USB.J.DN2, USB.J.DN1).width(SIG).priority(5)}
    {route(R_DP[2], USB.J.DP1).width(SIG)}
    {route(USB.J.CC1, USB.RCC1[1]).width(SIG).priority(4)}
    {route(USB.J.CC2, USB.RCC2[1]).width(SIG).priority(4)}
    {route(USB.J.GND_A, USB.J.SH1, 'Z').width(0.4)}
    {route(USB.J.GND_B, USB.J.SH2, 'Z').width(0.4)}

    {/* LED strings */}
    {route(R_LED1[2], D_PWR.A, 'Z').width(SIG)}
    {route(R_LED2[2], D_USR.A, 'Z').width(SIG)}

    {/* power: VBUS from both USB pads to the regulator and the header, 0.4 mm */}
    {route(USB.J.VBUS_A, LDO.U.VIN).width(0.4).priority(4)}
    {route(USB.J.VBUS_B, USB.J.VBUS_A).width(0.4).priority(4)}
    {route(LDO.U.VIN, LDO.CIN[1]).width(0.4).priority(4)}
    {route(LDO.CIN[1], J_TOP[18]).width(0.4).priority(4)}
    {route(SW_BOOT[2], J_TOP[2]).width(0.3)}

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
    {gnd(HSE.Y.GND1, 19.3, 21.0)}
    {gnd(HSE.Y.GND2, 15.9, 17.4)}
    {gnd(HSE.CIN[2], 11.9, 16.0)}
    {gnd(HSE.COUT[2], 11.9, 19.0)}
    {gnd(LSE.CIN[2], 18.675, 9.3)}
    {gnd(LSE.COUT[2], 13.7, 13.2)}
    {gnd(USB.RCC1[2], 40.825, 12.3)}
    {gnd(USB.RCC2[2], 40.825, 22.3)}
    {pwr(R_DP[1], 34.175, 12.9)}
    {gnd(LDO.U.GND, 44.0, 5.9)}
    {pwr(LDO.U.VOUT, 44.0, 10.2)}
    {gnd(LDO.CIN[2], 47.8, 5.9)}
    {gnd(LDO.COUT[2], 41.8, 5.9)}
    {pwr(LDO.COUT[1], 41.8, 10.1)}
    {gnd(R_BOOT0[2], 6.0, 8.4)}
    {gnd(SW_RST[2], 4.3, 25.4)}
    {gnd(C_NRST[2], 6.0, 24.9)}
    {gnd(R_BOOT1[2], 25.0, 27.5)}
    {gnd(D_PWR.K, 12.0, 14.0)}
    {pwr(R_LED1[1], 5.675, 15.5)}
    {route(R_LED2[1], '5.675 15.5').layers(['F.Cu']).width(0.3)}

    {/* the rest by the router: every GPIO to its header pin first, then SWD, reset and boot, which cross the fan-out */}
    {/* SWD: PA13 and PA14 up to their top header pins on the front, then the SWD header chained from those pins along the top and left edges on the back */}
    {route(U1.PA13, J_TOP[15]).layers(['F.Cu']).width(SIG)}
    {route(U1.PA14, J_TOP[14]).layers(['F.Cu']).width(SIG)}
    {route(J_TOP[15], J_SWD[4], 'V 5 H 4.7 V 20.04 Z').layer('B.Cu').width(SIG)}
    {route(J_TOP[14], J_SWD[2], 'V 4.4 H 4 V 14.96 Z').layer('B.Cu').width(SIG)}
    {route(U1.NRST, '2.5 22.58 B.Cu').width(SIG).priority(2)}
    {route(SW_RST[1], J_SWD[5]).layers(['F.Cu']).width(SIG)}
    {route(SW_RST[1], C_NRST[1]).width(SIG)}
    {route(J_SWD[5], J_TOP[4]).layer('B.Cu').layers(['B.Cu']).width(SIG)}
    {route(U1.BOOT0, R_BOOT0[1]).width(SIG)}
    {route(R_BOOT0[1], SW_BOOT[1]).width(SIG)}
    {route(D_USR.K, U1.PC13).width(SIG)}
    {route(R_BOOT1[1], J_BOT[10], 'Z').width(SIG)}
    {TOP_IO.map((p, i) => route(U1.pin(p), J_TOP[[3, 5, 6, 7, 8, 9, 10, 11, 12, 13][i]]).width(SIG).priority(1))}
    {BOTTOM_IO.map((p, i) =>
      route(U1.pin(p), J_BOT[i + 1])
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
