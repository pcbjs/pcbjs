// Sensor HAT: a Raspberry Pi HAT with BME280, LIS3DH, an OLED header, micro SD, a LiPo charger on USB-C, the HAT ID EEPROM, a buzzer, two buttons and a WS2812B-2020.
// Frame: millimetres, origin at the top-left corner of the outline, x right, y down. The outline is the HAT mechanical spec, 65 x 56.5 mm with 3 mm corners, the GPIO header along the top edge.
import PCB from '@pcbjs/fab/JLCPCB/2-Layer'
import { route, pour, keepout, via } from '@pcbjs/core'
import { Brand, roundedRect, circle, slot } from '@pcbjs/lib'
import * as sch from './hat.sch'

const W = 65,
  H = 56.5
// mounting: round 2.75 mm holes by the header, 2.75 mm slots at the far edge, each with a 6 mm keepout for the M2.5 screw head
const HOLES = [
  [3.5, 3.5],
  [61.5, 3.5],
]
const SLOTS = [
  [3.5, 52.5],
  [61.5, 52.5],
]
const BOARD = roundedRect(W, H, 3)

// a 1 mm band along the outline and round the mounting holes keeps courtyards, silk and pads clear of a case's wall and the screw
// heads; the GPIO socket, the USB-C and the micro SD sit on the edge by design
export default (
  <PCB name="sensor-hat" revision="0.1.0" schematic={sch} rules={{ strictNets: true, thermal: { gap: 0.3 }, edge: { width: 1, except: [J1, J4, J3] } }}>
    <path layer="Edge.Cuts" d={BOARD} />
    {HOLES.map(([x, y]) => (
      <path layer="Edge.Cuts" d={circle(2.75, x, y)} />
    ))}
    {SLOTS.map(([x, y]) => (
      <path layer="Edge.Cuts" d={slot(x - 0.75, y, x + 0.75, y, 2.75)} />
    ))}
    {[...HOLES, ...SLOTS].map(([x, y]) => keepout('all', circle(6.2, x, y)))}

    {/* GPIO socket, drawn on the front as in KiCad's HAT template and fitted as a stacking socket: pin 1 at (8.37, 4.77), the even row toward the edge */}
    <J1 at="8.37 4.77 90deg" />

    {/* HAT ID EEPROM under pins 27 and 28 */}
    <U4 at="41.5 11" thermal={{ 2: 'solid', 3: 'solid', 4: 'solid' }} />
    <C6 at="46 11 90deg" thermal={{ 2: 'solid' }} />
    <R5 at="37 11 90deg" />
    <TP1 at="37 14.5" />

    {/* charger: USB-C on the left edge, MCP73831 beside it, the LiPo connector below */}
    <J4 at="3.6 22 270deg" />
    <C4 at="11 18 90deg" />
    <U3 at="14 22" thermal={{ 2: 'solid' }} />
    <R3 at="17.5 24.5" />
    <C5 at="18.5 19.5" />
    <R1 at="10 26 90deg" />
    <R2 at="12 26 90deg" />
    <R4 at="14 15" />
    <D1 at="18 15" />
    <J5 at="5 36 90deg" />

    {/* the GND pads of the fine-pitch parts join the pour solid: their neighbours leave room for one spoke */}
    {/* sensors: the accelerometer in the middle, the BME280 at the right edge away from the charger */}
    <U2 at="33 26" thermal={{ 10: 'solid', 12: 'solid' }} />
    {/* the 0.5 mm pitch LGA leaves no room for a mask dam: one gang opening per pad row, as the fab would merge them */}
    <rect layer="F.Mask" x={31.455} y={24.775} w={0.65} h={2.45} fill />
    <rect layer="F.Mask" x={33.905} y={24.775} w={0.65} h={2.45} fill />
    <rect layer="F.Mask" x={32.275} y={24.455} w={1.45} h={0.65} fill />
    <rect layer="F.Mask" x={32.275} y={26.905} w={1.45} h={0.65} fill />
    <C2 at="33 30 180deg" />
    <U1 at="59 28" thermal={{ 1: 'solid', 5: 'solid', 7: 'solid' }} />
    <C1 at="59 31.5 180deg" />

    {/* OLED header below the GPIO, LED to the right */}
    <J2 at="18 10 270deg" />
    <D2 at="47 24" />
    <C7 at="47 27" />

    {/* micro SD, the card mouth at the bottom edge */}
    <J3 at="50 47.5" />
    <C3 at="41 40 90deg" />

    {/* buzzer and driver, buttons */}
    <BZ1 at="16 46" />
    <Q1 at="24 40" />
    <R6 at="24 36" />
    <SW1 at="28 50" />
    <SW2 at="35.5 50" />

    {/* 3V3, 0.3 mm: pin 1 to the OLED, pin 17 to the EEPROM, the accelerometer, the SD socket and the BME280 */}
    {route(J1[1]).X(J2[2]).width(0.3)}
    {route(J2[2]).X(J1[17]).width(0.3)}
    {route(J1[17]).X(R5[1]).width(0.3)}
    {route(R5[1]).X(U4.VCC).width(0.3)}
    {route(U4.VCC).X(C6[1]).width(0.3)}
    {route(J1[17]).X(C2[1]).width(0.3)}
    {route(C2[1]).X(U2.VDD).width(0.2)}
    {route(U2.VDD).X(U2.VDDIO).width(0.2)}
    {route(U2.VDDIO).X(U2.CS).width(0.2)}
    {route(C2[1]).X(C3[1]).width(0.3)}
    {route(C3[1]).X(J3.VDD).width(0.3)}
    {route(C2[1]).X(C1[1]).width(0.3)}
    {route(C1[1]).X(U1.VDD).width(0.2)}
    {route(U1.VDD).X(U1.VDDIO).width(0.2)}
    {route(U1.VDDIO).X(U1.CSB).width(0.2)}

    {/* 5V, 0.4 mm: pins 2 and 4 to the LED and the buzzer */}
    {route(J1[2]).Z(J1[4]).width(0.4)}
    {route(J1[4]).X(C7[1]).width(0.4)}
    {route(C7[1]).X(D2.VDD).width(0.3)}
    {route(J1[2]).X(BZ1[1]).width(0.4)}

    {/* I2C and the HAT ID bus */}
    {route(J1[3]).X(J2[4]).width(0.2)}
    {route(J2[4]).X(U2.SDA).width(0.2)}
    {route(U2.SDA).X(U1.SDI).width(0.2)}
    {route(J1[5]).X(J2[3]).width(0.2)}
    {route(J2[3]).X(U2.SCL).width(0.2)}
    {route(U2.SCL).X(U1.SCK).width(0.2)}
    {route(J1[27]).X(U4.SDA).width(0.2)}
    {route(J1[28]).X(U4.SCL).width(0.2)}
    {route(R5[2]).X(U4.WP).width(0.2)}
    {route(U4.WP).X(TP1[1]).width(0.2)}

    {/* SPI0 to the micro SD, card detect to GPIO25 */}
    {route(J1[19]).X(J3.CMD).width(0.2)}
    {route(J1[21]).X(J3.DAT0).width(0.2)}
    {route(J1[23]).X(J3.CLK).width(0.2)}
    {route(J1[24]).X(J3.DAT3).width(0.2)}
    {route(J1[22]).X(J3.CD).width(0.2)}

    {/* GPIO: accelerometer interrupt, LED data, buzzer, buttons */}
    {route(J1[11]).X(U2.INT1).width(0.2)}
    {route(J1[12]).X(D2.DIN).width(0.2)}
    {route(J1[33]).X(R6[1]).width(0.2)}
    {route(R6[2]).X(Q1[1]).width(0.2)}
    {route(Q1[3]).X(BZ1[2]).width(0.3)}
    {route(J1[29]).X(SW1.A).width(0.2)}
    {route(J1[31]).X(SW2.A).width(0.2)}

    {/* charger: VBUS from both USB-C pads, CC pull-downs, the cell, PROG and the charge LED */}
    {route(J4['B9']).X(C4[1]).width(0.4)}
    {route(J4['A9']).X(C4[1]).width(0.4)}
    {route(C4[1]).X(U3.VDD).width(0.4)}
    {route(U3.VDD).X(R4[1]).width(0.2)}
    {route(J4.CC1).X(R1[1]).width(0.2)}
    {route(J4.CC2).X(R2[1]).width(0.2)}
    {route(U3.VBAT).X(C5[1]).width(0.4)}
    {route(C5[1]).X(J5[1]).width(0.4)}
    {route(U3.PROG).X(R3[1]).width(0.2)}
    {route(U3.STAT).X(D1.K).width(0.2)}
    {route(R4[2]).X(D1.A).width(0.2)}

    {/* ground pins that a fine pitch keeps from the pour: tied pad to pad, then to the decoupling capacitor */}
    {route(U2.pad('12')).X(U2.RES).width(0.2)}
    {route(U2.pad('5')).X(U2.SA0).width(0.2)}
    {route(U2.SA0).X(C2[2]).width(0.2)}
    {route(U4.A0).Z(U4.A1).width(0.3)}
    {route(U4.A1).Z(U4.A2).width(0.3)}
    {route(U4.A2).Z(U4.VSS).width(0.3)}
    {route(C6[2]).X(U4.VSS).width(0.3)}

    {/* stitching vias for F.Cu GND pieces the tracks fence off: by R1 and R2, below and right of U2, by SW2, by C3, by C4, by D2, by C7, by U1 and by C1 */}
    {[
      [11, 24.4],
      [31.3, 29.4],
      [35.3, 27.3],
      [41.2, 50.8],
      [41, 38.23],
      [11.8, 17.2],
      [45.49, 24.53],
      [48.56, 27],
      [59.56, 28.37],
      [56.45, 28],
      [55.78, 33.1],
    ].map(([x, y]) => via(GND, [x, y], { drill: 0.2, size: 0.45 }))}
    {/* each button has two pads per side, joined inside the switch but not on the board */}
    {route(SW1.pad('1')).X(SW1.pad('2')).width(0.2)}
    {route(SW2.pad('1')).X(SW2.pad('2')).width(0.2)}

    {/* ground pours on both sides, thermal reliefs on every pad, the GPIO ground pins included */}
    {pour(GND, 'F.Cu', BOARD)}
    {pour(GND, 'B.Cu', BOARD)}

    <text layer="F.SilkS" at="32.5 33.5" size={1}>
      sensor-hat
    </text>
    <Brand at="35 19.25" height={6} />
  </PCB>
)
