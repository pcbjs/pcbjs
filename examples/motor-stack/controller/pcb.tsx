// Controller: STM32G431 with FDCAN, 60 x 45 mm, two layers. The board to board socket is on the back, mating the driver's header below.
// Frame: millimetres, origin at the top-left corner of the outline, x right, y down, seen from the top of the stack.
import PCB from '@pcbjs/fab/JLCPCB/2-Layer'
import { pour, via, reference } from '@pcbjs/core'
import { Brand, MountingHole, roundedRect, rect } from '@pcbjs/lib'
import { W, H, HOLES, TEST_PADS } from '../lib/mech'
import { SOCKET_AT, socketPin, headerPin } from '../lib/header'
import { V5, nHA, nLA, nHB, nLB, nHC, nLC, ISA, ISB, ISC, VSNS, nFAULT, SD } from '../lib/nets'
import { chain } from '../lib/wire'
import * as sch from './controller.sch'

const Hole = MountingHole(3.2)
const SIG = 0.2,
  PWR = 0.4

export default (
  <PCB name="controller" title="Motor stack controller" revision="0.1.0" schematic={sch} color="blue">
    <path layer="Edge.Cuts" d={roundedRect(W, H, 2)} />
    {HOLES.map(([x, y], i) => (
      <Hole ref={`H${i + 1}`} at={`${x} ${y}`} />
    ))}

    {/* the socket on the back, mating the driver header; the MCU turned so TIM1 faces it */}
    <J1 at={SOCKET_AT} side="B" thermal={{ 9: 'solid', 10: 'solid', 17: 'solid', 18: 'solid' }} />
    <U1 at="28 21 180deg" />

    {/* decoupling at the three VDD pads and VDDA */}
    <C_VDD1 at="20.8 24" />
    <C_VDD2 at="31 28.2 90deg" />
    <C_VDD3 at="25 13.6 90deg" />
    <C_VDDA at="27.4 13.6 90deg" />

    {/* 8 MHz crystal right of PF0 and PF1 */}
    <Y1 at="38 20.5 90deg" />
    <C_X1 at="41 18.8" />
    <C_X2 at="41 22.2" />

    {/* 5 V to 3.3 V regulator near the socket's 5 V pins */}
    <U3 at="16 7" />
    <C_LIN at="12.5 7 90deg" />
    <C_LOUT at="19.5 7 90deg" />
    <C_BULK at="22 7 90deg" />

    {/* CAN on the right edge */}
    <U2 at="47 22" />
    <C_CVCC at="47 17" />
    <C_CVIO at="47 27" />
    <J2 at="55 22 90deg" />
    <R_TERM at="47 31" />

    {/* SWD along the top */}
    <J3 at="34 4 -90deg" thermal={{ 3: 'solid', 5: 'solid' }} />
    <C_NRST at="40.5 14.5" />
    <R_BOOT at="25 30" />
    <R_FLT at="16 26 90deg" />
    <R_SD at="18 26 90deg" />
    <R_LED at="38 33" />
    <D1 at="42 33 180deg" />

    {/* test pads for the jig on the back */}
    {TP.map((T, i) => (
      <T at={`${TEST_PADS[i].x} ${TEST_PADS[i].y}`} side="B" />
    ))}
    {TEST_PADS.map(t => (
      <text layer="B.SilkS" at={`${t.x} ${t.y - 2.2}`} size={0.7}>
        {t.name}
      </text>
    ))}

    {/* supplies */}
    {chain(PWR, J1[socketPin(V5)], J1[socketPin(V5) + 1])}
    {chain(PWR, J1[socketPin(V5)], C_LIN[1], U3.VIN, U3.EN)}
    {chain(PWR, U3.VOUT, C_LOUT[1], C_BULK[1])}
    {chain(PWR, C_LIN[1], C_CVCC[1], U2.VCC)}
    {chain(0.3, C_BULK[1], C_VDD3[1], U1.pad('24'))}
    {chain(0.3, C_VDD3[1], C_VDDA[1], U1.VDDA)}
    {chain(0.3, U1.VDDA, U1['VREF+'])}
    {chain(0.3, C_VDDA[1], U1.pad('48'))}
    {chain(0.3, U1.pad('48'), C_VDD2[1])}
    {chain(0.3, C_VDD1[1], U1.pad('36'))}
    {chain(0.3, C_VDD3[1], C_VDD1[1])}
    {chain(0.3, U1.VBAT, C_VDD2[1])}
    {chain(SIG, C_CVIO[1], U2.VIO)}
    {chain(SIG, C_VDD2[1], C_CVIO[1])}
    {chain(SIG, C_VDD1[1], R_FLT[1], R_SD[1])}
    {chain(SIG, C_CVIO[1], R_LED[1])}
    {chain(SIG, C_LOUT[1], J3[1])}

    {/* the bridge commands, sense and status to the socket */}
    {(
      [
        [U1.PA8, nHA],
        [U1.PB13, nLA],
        [U1.PA9, nHB],
        [U1.PB14, nLB],
        [U1.PA10, nHC],
        [U1.PB15, nLC],
        [U1.PA1, ISA],
        [U1.PA7, ISB],
        [U1.PB0, ISC],
        [U1.PA0, VSNS],
        [U1.PB12, nFAULT],
        [U1.PB11, SD],
      ] as const
    ).map(([pin, net]) => chain(SIG, pin, J1[socketPin(net)]))}
    {chain(SIG, R_FLT[2], U1.PB12)}
    {chain(SIG, R_SD[2], U1.PB11)}
    {/* clock, CAN, debug */}
    {chain(SIG, U1.PF0, Y1.X1, C_X1[1])}
    {chain(SIG, U1.PF1, Y1.X2, C_X2[1])}
    {chain(SIG, U1.PA12, U2.TXD)}
    {chain(SIG, U1.PA11, U2.RXD)}
    {chain(0.3, U2.CANH, R_TERM[1], J2[1])}
    {chain(0.3, U2.CANL, R_TERM[2], J2[2])}
    {chain(SIG, U1.PA13, J3[2])}
    {chain(SIG, U1.PA14, J3[4])}
    {chain(SIG, U1.PG10, C_NRST[1], J3[10])}
    {chain(SIG, U1.PB8, R_BOOT[1])}
    {chain(SIG, U1.PC13, D1.K)}
    {chain(SIG, R_LED[2], D1.A)}

    {/* the jig's test pads */}
    {chain(PWR, C_LIN[1], TP[1][1])}
    {chain(0.3, C_VDD1[1], TP[2][1])}
    {chain(SIG, J3[2], TP[3][1])}
    {chain(SIG, J3[4], TP[4][1])}
    {chain(SIG, C_NRST[1], TP[5][1])}
    {chain(0.3, R_TERM[1], TP[6][1])}
    {chain(0.3, R_TERM[2], TP[7][1])}

    {/* ground: both layers poured, stitched */}
    {pour(GND, 'F.Cu', rect(W, H), { connect: 'solid' })}
    {pour(GND, 'B.Cu', rect(W, H))}
    {[
      [14, 14],
      [14, 30],
      [26, 36],
      [44, 36],
      [44, 8],
      [52, 14],
      [30, 9],
      [36, 30],
    ].map(([x, y]) => via(GND, `${x} ${y}`))}
    {/* F.Cu GND pieces the tracks fence off: VSS pin 35 tied to its decoupling capacitor, the VDDA capacitor to the VDD3 one, a stitching via in each other piece */}
    {chain(0.3, U1.pad('35'), C_VDD1[2])}
    {chain(0.3, C_VDDA[2], C_VDD3[2])}
    {[
      [31.38, 27.11],
      [21.92, 24.32],
      [39.85, 19.4],
      [25.75, 17.97],
      [13.88, 7.39],
      [22.01, 5.3],
      [40.67, 20.8],
      [45.95, 17.75],
      [48.58, 25.9],
    ].map(([x, y]) => via(GND, `${x} ${y}`, { drill: 0.2, size: 0.45 }))}

    <text layer="F.SilkS" at="44 41" size={1.2}>
      motor-stack controller
    </text>

    {/* the driver below, its header in the socket: the socket's V5 pin on the header's V5 pin, the socket turned 180deg */}
    {reference('../driver/pcb.tsx', { mate: { local: J1[socketPin(V5)], remote: 'J1', pin: headerPin(V5), nets: true }, stack: 'below', rotate: 180 })}
    <Brand at="17.35 41" height={6} />
  </PCB>
)
