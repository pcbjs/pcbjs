// sdram: an STM32F429ZI with a 16-bit SDRAM on its FMC, 55 x 45 mm, four layers on the JLCPCB preset: signals on F.Cu and
// B.Cu, GND on In1.Cu, 3V3 on In2.Cu. The schematic is sdram.sch.ts, the passives' part numbers sdram.sourcing.ts.
// Frame: millimetres, origin at the top-left corner of the outline, x right, y down. USB-C on the top edge.
import PCB from '@pcbjs/fab/JLCPCB/4-Layer'
import { route, pour, via } from '@pcbjs/core'
import { Brand, MountingHole, rect, roundedRect } from '@pcbjs/lib'
import { TSOP54 } from './lib/parts'
import { JLCPCB_4L_7628 } from '@pcbjs/lib/stackups'
import './sdram.sourcing'
import * as sch from './sdram.sch'

const W = 55,
  H = 45
const STUB = 0.25

// MCU local frame, before its 90 degree turn: pin n sits on side L, B, R or T at position t along that side
type Side = 'L' | 'B' | 'R' | 'T'
function pinSide(n: number): [Side, number] {
  if (n <= 36) return ['L', -8.75 + (n - 1) * 0.5]
  if (n <= 72) return ['B', -8.75 + (n - 37) * 0.5]
  if (n <= 108) return ['R', 8.75 - (n - 73) * 0.5]
  return ['T', 8.75 - (n - 109) * 0.5]
}
// a point at distance r from the centre, inward of side s at t
const at = (s: Side, t: number, r: number) => {
  const [x, y] = s === 'L' ? [-r, t] : s === 'B' ? [t, r] : s === 'R' ? [r, t] : [t, -r]
  return `${x} ${y}` as `${number} ${number}`
}
// a 0402 on the back, radial, pad 1 outward: side B mirrors pad 1 to +x first
const capRot: Record<Side, number> = { L: 180, R: 0, T: 90, B: -90 }

const R_VDD = 9.25,
  R_GND = 9.25 - 0.96
// supply pins with a capacitor: the pin, its capacitor, and the VSS pin beside it whose via lands on the capacitor's ground pad
const MCU_CAPS: [number, number | null][] = [
  [6, null],
  [17, 16],
  [30, 31],
  [33, null],
  [39, 38],
  [52, 51],
  [62, 61],
  [72, null],
  [84, 83],
  [95, 94],
  [108, 107],
  [121, 120],
  [131, 130],
  [144, null],
]

function mcuDecoupling() {
  const out: any[] = []
  MCU_CAPS.forEach(([pin, vss], i) => {
    const [s, t0] = pinSide(pin)
    const t = pin === 33 ? t0 - 0.25 : t0 // VREF+ and VDDA share one via between their pads
    const C = C_MCU[i]
    // the 3V3 via leans away from the VSS stub beside it, which keeps it 0.28 mm clear of the via hole
    const tv = vss ? pinSide(vss)[1] : t
    const tp = vss ? t - 0.3 * Math.sign(tv - t) : t
    out.push(<C at={`${at(s, t, (R_VDD + R_GND) / 2)} ${capRot[s]}deg`} side="B" />)
    out.push(route(U1.pad(String(pin)), at(s, tp, R_VDD), `L ${at(s, t, R_VDD + 0.3)} Z`).width(STUB), via(V3V3, at(s, tp, R_VDD)))
    if (vss) {
      const tg = t + 0.45 * Math.sign(tv - t) // on the edge of the capacitor's ground pad
      out.push(route(U1.pad(String(vss)), at(s, tg, R_GND), 'Z').width(STUB), via(GND, at(s, tg, R_GND)))
    } else out.push(via(GND, at(s, t, R_GND)))
  })
  out.push(route(U1.pad('32'), at('L', 7.0, R_VDD), 'Z').width(STUB))
  out.push(route(U1.pad('143'), U1.pad('144'), 'Z').width(STUB)) // PDR_ON high: the internal reset on
  // VCAP1 and VCAP2: in, then diagonal to a 2.2 uF on the back
  for (const [pin, t, C, net] of [
    [71, 7.4, C_VCAP1, VCAP1],
    [106, -6.9, C_VCAP2, VCAP2],
  ] as const) {
    const [s, t0] = pinSide(pin)
    const [x0, y0] = at(s, t0, 9.5).split(' ').map(Number),
      [x1, y1] = at(s, t, 8.65).split(' ').map(Number)
    out.push(<C at={`${at(s, t, 8.65 - 0.48)} ${capRot[s]}deg`} side="B" />)
    out.push(route(U1.pad(String(pin)), at(s, t, 8.65), `L ${x0} ${y0} L ${x1} ${y1} Z`).width(STUB), via(net, at(s, t, 8.65)), via(GND, at(s, t, 8.65 - 0.96)))
  }
  return out
}

// SDRAM supply pins, in its own frame: each one in to a via under the body, a 100 nF on the back for each 3V3 pin
const RAM_VDD: [number, number][] = [
  [1, -10.4],
  [3, -8.8],
  [9, -4.0],
  [14, 0],
  [27, 10.4],
  [43, -1.6],
  [49, -6.4],
]
const RAM_VSS: [number, number][] = [
  [6, -6.4],
  [12, -1.6],
  [28, 10.4],
  [41, 0],
  [46, -4.0],
  [52, -8.8],
  [54, -10.4],
]
function ramDecoupling() {
  const out: any[] = []
  RAM_VDD.forEach(([pin, y], i) => {
    const sx = pin <= 27 ? -1 : 1,
      C = C_RAM[i]
    out.push(<C at={`${sx * (3.85 - 0.825)} ${y} ${sx < 0 ? 180 : 0}deg`} side="B" />)
    out.push(route(U2.pad(String(pin)), `${sx * 3.85} ${y}`, 'Z').width(STUB), via(V3V3, `${sx * 3.85} ${y}`), via(GND, `${sx * (3.85 - 1.65)} ${y}`))
  })
  for (const [pin, y] of RAM_VSS) {
    const sx = pin <= 27 ? -1 : 1
    out.push(route(U2.pad(String(pin)), `${sx * 3.85} ${y}`, 'Z').width(STUB), via(GND, `${sx * 3.85} ${y}`))
  }
  return out
}

// the SDRAM bus: MCU pin, SDRAM pin. DATA is the 16 data lines, FMC bit order, and both byte masks; ADDR the address, bank
// and command lines. The data bits land on the SDRAM pins of RAM_DQ in sdram.sch.ts, which uncrosses each byte lane.
const FMC_D = ['PD14', 'PD15', 'PD0', 'PD1', 'PE7', 'PE8', 'PE9', 'PE10', 'PE11', 'PE12', 'PE13', 'PE14', 'PE15', 'PD8', 'PD9', 'PD10'] as const
const DATA: [string, string][] = [...FMC_D.map((p, bit): [string, string] => [p, `DQ${RAM_DQ.indexOf(bit as any)}`]), ['PE0', 'LDQM'], ['PE1', 'UDQM']]
const ADDR: [string, string][] = [
  ['PF0', 'A0'],
  ['PF1', 'A1'],
  ['PF2', 'A2'],
  ['PF3', 'A3'],
  ['PF4', 'A4'],
  ['PF5', 'A5'],
  ['PF12', 'A6'],
  ['PF13', 'A7'],
  ['PF14', 'A8'],
  ['PF15', 'A9'],
  ['PG0', 'A10'],
  ['PG1', 'A11'],
  ['PG2', 'A12'],
  ['PG4', 'BA0'],
  ['PG5', 'BA1'],
  ['PF11', 'RAS'],
  ['PG15', 'CAS'],
  ['PC0', 'WE'],
  ['PC2', 'CS'],
  ['PC3', 'CKE'],
]
const pin = (p: any, name: string) => p[name]
// the SDRAM, turned 90 degrees at (42, 24): pins 1 to 27 along the bottom row at y 29.3 from x 31.6, 28 to 54 back
// along the top row at y 18.7
const RAM_X0 = 31.6,
  RAM_PITCH = 0.8
const ramPad = (name: string) => {
  const n = 1 + (TSOP54 as readonly string[]).indexOf(name)
  return n <= 27 ? { x: RAM_X0 + (n - 1) * RAM_PITCH, top: false } : { x: RAM_X0 + (54 - n) * RAM_PITCH, top: true }
}
// every bus line enters its pad straight from outside the package, through a waypoint 2.7 mm out from the pad row
const approach = (name: string) => {
  const p = ramPad(name)
  return `X ${p.x.toFixed(2)} ${p.top ? 16.0 : 32.0} XZ`
}
// lines too short for their group: a waypoint first, into free board where the tuner has room; WE and A3 into the bottom right corner, A7, A8, A9, A11 into the top right one
const DETOUR: Record<string, string> = { RAS: 'X 50 38 ', CS: 'X 47 39 ', WE: 'X 50 41 ', A3: 'X 45 42 ', A9: 'X 50 6 ', A7: 'X 53 12 ', A11: 'X 47 10 ', A8: 'X 52 9 ' }
const busPath = (name: string) => (DETOUR[name] ?? '') + approach(name)

// the SDRAM clock length in mm: longer than every data line, so data settles before the clock edge arrives
const CLK_LEN = 62
// the skew budget of each match group: at 143 MHz the period is 1000 / 143 = 7 ns, a 50 ohm microstrip on this stackup
// carries a signal about 6 ps per mm, and 60 ps, under 1 % of the period, buys 60 / 6 = 10 mm of length difference
const SKEW_MM = 10

const SMALL = { drill: 0.2, size: 0.45 }
// a short stub from a pad to a via into a plane
const toVia = (pad: any, net: any, x: number, y: number, w = 0.3) => [route(pad, `${x} ${y}`, 'Z').width(w), via(net, `${x} ${y}`)]

// JLC04161H-3313: the preset's 7628 prepreg is 0.21 mm, which puts a 50 ohm microstrip at 0.37 mm, too wide to leave a
// 0.5 mm LQFP pad between two neighbours. JLCPCB's 3313 stackup has 0.0994 mm prepreg and gives 0.17 mm. Source: the
// JLCPCB impedance calculator's 4-layer 1.6 mm JLC04161H-3313 build, read 2026-10.
const JLC_3313 = {
  ...JLCPCB_4L_7628,
  layers: JLCPCB_4L_7628.layers.map(l => (l.type === 'prepreg' ? { ...l, material: '3313', thickness: 0.0994, er: 4.1 } : l.type === 'core' ? { ...l, thickness: 1.265 } : l)),
}

const Hole = MountingHole(2.2)

export default (
  <PCB
    name="sdram"
    revision="0.1.0"
    schematic={sch}
    stackup={JLC_3313}
    classes={{ sdram: { impedance: 50, autoroute: { tune: { amplitude: 5, spacing: 0.25 } } }, usb: { gap: 0.15, skew: 0.1, uncoupled: 6 } }}
    autoroute={{ layers: ['F.Cu', 'B.Cu'] }}
  >
    <path layer="Edge.Cuts" d={roundedRect(W, H, 1.5)} />

    <J1 at="9.5 3.4 180deg" />
    <R_CC1 at="15.6 5 90deg" />
    <R_CC2 at="3.4 5 90deg" />
    <U3 at="25 5" />
    <C_IN at="18.6 4.5 90deg" />
    <C_OUT at="31.6 5 90deg" />

    <U1 at="16 24 90deg" />
    <g at="16 24 90deg">{mcuDecoupling()}</g>

    {/* the SDRAM turned so its pin rows face up and down: the bus flows right from the MCU and splits above and below it */}
    <U2 at="42 24 90deg" />
    <g at="42 24 90deg">{ramDecoupling()}</g>

    <Y1 at="19 39" />
    <C_X1 at="15.1 39.85 180deg" />
    <C_X2 at="22.6 38.15" />
    <SW1 at="7 40" />
    <C_RST at="12 40 90deg" />
    <J2 at="2 27" />
    <R_BOOT at="2.5 35.5 -90deg" />

    {/* USB-C: the pair from the B6 and B7 contacts, which sit P left and N right like PA12 and PA11, at 90 ohm */}
    {route([J1.pad('B6'), J1.pad('B7')], [U1.PA12, U1.PA11]).impedance(90)}
    {/* the A6 and A7 contacts join their nets on B.Cu under the receptacle */}
    {(
      [
        ['B6', USB_DP, 8.75, 6.2],
        ['A6', USB_DP, 9.75, 6.2],
        ['A7', USB_DN, 9.25, 5.4],
        ['B7', USB_DN, 10.25, 5.4],
      ] as const
    ).map(([pad, net, x, y]) => [route(J1.pad(pad), `${x} ${y}`, 'Z').width(0.2), via(net, `${x} ${y}`, SMALL)])}
    {route('8.75 6.2 B.Cu', '9.75 6.2 B.Cu', 'Z').net(USB_DP).width(0.2)}
    {route('9.25 5.4 B.Cu', '10.25 5.4 B.Cu', 'Z').net(USB_DN).width(0.2)}
    {(
      [
        ['B1', GND, 6.25],
        ['B4', VBUS, 7.05],
        ['A4', VBUS, 11.95],
        ['A1', GND, 12.75],
      ] as const
    ).map(([pad, net, x]) => [route(J1.pad(pad), `${x} 8.75`, 'Z').width(0.3), via(net, `${x} 8.75`, SMALL)])}
    {route('7.05 8.75 B.Cu', '11.95 8.75 B.Cu', 'Z').net(VBUS).width(0.4)}
    {route(J1.CC1, R_CC1[1]).width(0.2)}
    {route(J1.CC2, R_CC2[1]).width(0.2)}
    {toVia(R_CC1[2], GND, 15.6, 2.9)}
    {toVia(R_CC2[2], GND, 3.4, 2.9)}

    {/* the LDO: VBUS in, 3V3 out through the tab to the In2.Cu plane */}
    {route(J1.pad('A4'), U3.VIN).width(0.4)}
    {route(C_IN[1], U3.VIN).width(0.4)}
    {route(C_IN[2], U3.GND).width(0.4)}
    {toVia(U3.GND, GND, 24, 2.7, 0.4)}
    {route(C_OUT[1], U3.pad('4')).width(0.5)}
    {toVia(C_OUT[2], GND, 31.6, 2.6, 0.4)}
    {toVia(U3.pad('4'), V3V3, 28.15, 8.2, 0.5)}
    {route(U3.pad('2'), U3.pad('4'), 'Z').width(0.5)}

    {/* the 25 MHz crystal under PH0 and PH1 */}
    {route(U1.PH0, Y1.X1).width(0.2)}
    {route(U1.PH1, Y1.X2).width(0.2)}
    {route(Y1.X1, C_X1[1], 'Z').width(0.2)}
    {route(Y1.X2, C_X2[1], 'Z').width(0.2)}
    {toVia(Y1.pad('4'), GND, 16.6, 37.4)}
    {toVia(Y1.pad('2'), GND, 21.5, 40.9)}
    {toVia(C_X1[2], GND, 14.28, 41.4)}
    {toVia(C_X2[2], GND, 23.43, 39.6)}

    {/* reset and boot */}
    {route(SW1.pad('1'), SW1.pad('2'), 'Z').width(0.3)}
    {route(U1.NRST, SW1.pad('2')).width(0.2)}
    {route(C_RST[1], SW1.pad('2')).width(0.2)}
    {toVia(C_RST[2], GND, 12, 37.8)}
    {toVia(SW1.pad('3'), GND, 4, 43.3)}
    {toVia(SW1.pad('4'), GND, 10, 43.3)}
    {route(U1.BOOT0, J2[2]).width(0.2)}
    {route(J2[2], R_BOOT[1]).width(0.2)}
    {toVia(R_BOOT[2], GND, 2.5, 37.6)}

    {/* the SDRAM bus, all in the sdram class at 50 ohm, meanders up to 5 mm high; see examples/README.md for why DATA does not close */}
    {DATA.map(([m, r]) => route(pin(U1, m), pin(U2, r), busPath(r)).match('DATA', SKEW_MM).length({ max: CLK_LEN }))}
    {ADDR.map(([m, r]) => route(pin(U1, m), pin(U2, r), busPath(r)).match('ADDR', SKEW_MM))}
    {/* the clock routes first and is tuned to CLK_LEN; every data line must stay under it */}
    {route(U1.PG8, U2.CLK, approach('CLK')).priority(3).length(CLK_LEN)}

    <Hole ref="H1" at="52 3" />
    <Hole ref="H2" at="52 42" />

    {pour(GND, 'In1.Cu', rect(W, H))}
    {pour(V3V3, 'In2.Cu', rect(W, H))}

    <text layer="F.SilkS" at="44 41" size={1}>
      sdram
    </text>
    <text layer="F.SilkS" at="44 42.8" size={0.7}>
      rev 0.1.0
    </text>
    <Brand at="41.7 3.5" height={4.5} />
  </PCB>
)
