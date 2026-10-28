// usb3-hub: a bus powered four port USB 3.2 Gen 1 hub, 72 x 44 mm, JLCPCB four layer 3313 stackup. A TI TUSB8041 in its
// 9 x 9 mm VQFN-64, an upstream USB-C receptacle on the right edge, four USB 3.0 Type-A receptacles along the top edge, a
// TPS2065C current limited switch and an indicator LED per port, a TPD4EUSB30 on every SuperSpeed lane and a USBLC6-2SC6 on
// every USB 2.0 pair, a 3.3 V LDO and a 1.2 V buck, a 24 MHz crystal.
// Frame: mm, origin at the top-left corner of the outline, x right, y down.
// Layers: signals on F.Cu and B.Cu, GND on In1.Cu, VBUS, 1.2 V and 3.3 V pours on In2.Cu.
import PCB from '@pcbjs/fab/JLCPCB/4-Layer-3313'
import { nets, group, route, pour, via, NC, type RouteEnd } from '@pcbjs/core'
import { Brand, QFN, SOT23, Crystal3225, withPins, chip, R0402, C0402, C0603, C0805, C1206, LED0603, rect, roundedRect } from '@pcbjs/lib'
import { USBC24, USB3A, USON10 } from './lib/parts.js'

const W = 72,
  H = 44
const usb = { class: 'usb' } as const,
  ss = { class: 'ss' } as const,
  power = { class: 'power' } as const

const { GND, VBUS, V3V3, V1V2, SW, FB, XI, XO, GRST, RREF, VSENSE, CC1, CC2, PLED, PEN, POC, GANG } = nets({
  GND: power,
  VBUS: power,
  V3V3: { class: 'rail' },
  V1V2: power,
  SW: power,
})
// the upstream port: USB 2.0, the SuperSpeed lane on the hub side of the AC capacitors (TX) and on the connector side (TXC)
const UP = nets('UP', { DP: usb, DN: usb, TXP: ss, TXN: ss, TXCP: ss, TXCN: ss, RXP: ss, RXN: ss })

// ---- the hub: TUSB8041RGC, pin map from SLLSEE4E. Downstream ports 1 and 2 on pins 1 to 16, 3 and 4 on 17 to 32, control on
// 33 to 48, upstream, clock and reference on 49 to 64.
const HUB_PINS = {
  1: 'DP1',
  2: 'DM1',
  3: 'TXP1',
  4: 'TXM1',
  5: 'VDD',
  6: 'RXP1',
  7: 'RXM1',
  8: 'VDD',
  9: 'DP2',
  10: 'DM2',
  11: 'TXP2',
  12: 'TXM2',
  13: 'VDD',
  14: 'RXP2',
  15: 'RXM2',
  16: 'VDD33',
  17: 'DP3',
  18: 'DM3',
  19: 'TXP3',
  20: 'TXM3',
  21: 'VDD',
  22: 'RXP3',
  23: 'RXM3',
  24: 'DP4',
  25: 'DM4',
  26: 'TXP4',
  27: 'TXM4',
  28: 'VDD',
  29: 'RXP4',
  30: 'RXM4',
  31: 'VDD',
  32: 'PWRCTL4',
  33: 'PWRCTL3',
  34: 'VDD33',
  35: 'PWRCTL2',
  36: 'PWRCTL1',
  37: 'SDA',
  38: 'SCL',
  39: 'SMBUSZ',
  40: 'FULLPWRMGMTZ',
  41: 'PWRCTL_POL',
  42: 'GANGED',
  43: 'OVERCUR4Z',
  44: 'OVERCUR3Z',
  45: 'AUTOENZ',
  46: 'OVERCUR1Z',
  47: 'OVERCUR2Z',
  48: 'USB_VBUS',
  49: 'TEST',
  50: 'GRSTZ',
  51: 'VDD',
  52: 'VDD33',
  53: 'DP_UP',
  54: 'DM_UP',
  55: 'TXP_UP',
  56: 'TXM_UP',
  57: 'VDD',
  58: 'RXP_UP',
  59: 'RXM_UP',
  60: 'NC',
  61: 'XO',
  62: 'XI',
  63: 'VDD33',
  64: 'USB_R1',
  EP: 'GND',
} as const
const HUB = QFN(64, 9, 0.5, 6, { pinNames: HUB_PINS, vias: 4 })

// ---- downstream ports, numbered as the hub numbers them: port 1 at the right, port 4 at the left
const PORT_X = [63, 45, 27, 9]
const TPS2065C = SOT23(5, { pinNames: ['OUT', 'GND', 'FLT', 'EN', 'IN'] })
const USBLC6 = SOT23(6, { pinNames: { 1: 'IO1', 6: 'IO1', 3: 'IO2', 4: 'IO2', 2: 'GND', 5: 'VBUS' } })
const ESD_SS = USON10
const C100N = () => C0402('100n').source({ MPN: 'CL05B104KO5NNNC', 'MPN:LCSC': 'C1525' })

// each port is a group, so findings, inspect and the viewer name its parts P1/SW, P3/J and so on
const PORTS = PORT_X.map((x, i) => {
  const n = i + 1
  const P = nets(`P${n}`, { VBUS: power, DP: usb, DN: usb, TXP: ss, TXN: ss, TXCP: ss, TXCN: ss, RXP: ss, RXN: ss })
  return group(`P${n}`, {
    n,
    x,
    P,
    J: USB3A('692122030100')
      .source({ MPN: '692122030100' })
      .connect({ VBUS: P.VBUS, DN: P.DN, DP: P.DP, GND, SSRXN: P.RXN, SSRXP: P.RXP, SSTXN: P.TXCN, SSTXP: P.TXCP, SHIELD: GND }),
    SW: TPS2065C({ value: 'TPS2065C', model: { file: './models/SOT-23-5.step', offset: [0.03, 0, 0] } })
      .source({ MPN: 'TPS2065CDBVR' })
      .connect({ IN: VBUS, OUT: P.VBUS, EN: PEN, FLT: POC, GND }),
    CIN: C100N().connect(VBUS, GND),
    COUT: C1206('47u').source({ MPN: 'CL31A476MQHNNNE' }).connect(P.VBUS, GND),
    LED: LED0603('green').source({ MPN: 'LTST-C191KGKT' }).connect({ A: P.LED, K: GND }),
    RLED: R0402('2.2k').source({ MPN: '0402WGF2201TCE' }).connect(P.VBUS, P.LED),
    ESS: ESD_SS('TPD4EUSB30').source({ MPN: 'TPD4EUSB30DQAR' }).connect({ D1P: P.TXP, D1N: P.TXN, D2P: P.RXP, D2N: P.RXN, GND }),
    // on the back: IO1 is D- so that the lines leave in the hub's order after the crossover under the receptacle
    E2: USBLC6('USBLC6-2SC6').source({ MPN: 'USBLC6-2SC6', 'MPN:LCSC': 'C7519' }).connect({ IO1: P.DN, IO2: P.DP, GND, VBUS }),
    CTP: C100N().connect(P.TXP, P.TXCP),
    CTN: C100N().connect(P.TXN, P.TXCN),
  })
})
const [P1, P2, P3, P4] = PORTS.map(p => p.P)

const U1 = HUB({ value: 'TUSB8041', model: { file: './models/QFN-64-1EP_9x9mm_P0.5mm_EP6x6mm.step' } })
  .source({ MPN: 'TUSB8041RGCR' })
  .connect({
    DP1: P1.DP,
    DM1: P1.DN,
    TXP1: P1.TXP,
    TXM1: P1.TXN,
    RXP1: P1.RXP,
    RXM1: P1.RXN,
    DP2: P2.DP,
    DM2: P2.DN,
    TXP2: P2.TXP,
    TXM2: P2.TXN,
    RXP2: P2.RXP,
    RXM2: P2.RXN,
    DP3: P3.DP,
    DM3: P3.DN,
    TXP3: P3.TXP,
    TXM3: P3.TXN,
    RXP3: P3.RXP,
    RXM3: P3.RXN,
    DP4: P4.DP,
    DM4: P4.DN,
    TXP4: P4.TXP,
    TXM4: P4.TXN,
    RXP4: P4.RXP,
    RXM4: P4.RXN,
    // ganged power control: PWRCTL1 enables all four switches, OVERCUR1Z collects their open-drain faults
    PWRCTL1: PEN,
    OVERCUR1Z: POC,
    GANGED: GANG,
    PWRCTL2: NC,
    PWRCTL3: NC,
    PWRCTL4: NC,
    OVERCUR2Z: NC,
    OVERCUR3Z: NC,
    OVERCUR4Z: NC,
    DP_UP: UP.DP,
    DM_UP: UP.DN,
    TXP_UP: UP.TXP,
    TXM_UP: UP.TXN,
    RXP_UP: UP.RXP,
    RXM_UP: UP.RXN,
    VDD: V1V2,
    VDD33: V3V3,
    GND,
    XI,
    XO,
    GRSTZ: GRST,
    USB_R1: RREF,
    USB_VBUS: VSENSE,
    TEST: GND,
    // strap pins left to their internal pulls: I2C mode with no EEPROM, power switching on, active high PWRCTL
    SDA: NC,
    SCL: NC,
    SMBUSZ: NC,
    FULLPWRMGMTZ: NC,
    PWRCTL_POL: NC,
    AUTOENZ: NC,
  })

// ---- upstream: USB-C sink on lane 2 only; the other plug orientation would need a flip mux such as the HD3SS3220. Lane 2
// because its RX contacts sit on the rear row above the USB 2.0 pair and its TX contacts on the front row can drop to B.Cu
// and come back up between them, which is the hub's order. RX2 is wired with its polarity inverted, which every USB 3
// receiver corrects in Polling, so that the pair needs no crossover.
const J0 = USBC24({ value: '12401610E4-2A', model: { file: './models/USB_C_Receptacle_Amphenol_12401610E4-2A.step' } })
  .source({ MPN: '12401610E4-2A' })
  .connect({
    GND,
    VBUS,
    CC1,
    CC2,
    DP: UP.DP,
    DN: UP.DN,
    SBU1: NC,
    SBU2: NC,
    TX2P: UP.TXCP,
    TX2N: UP.TXCN,
    RX2P: UP.RXN,
    RX2N: UP.RXP,
    TX1P: NC,
    TX1N: NC,
    RX1P: NC,
    RX1N: NC,
    SHIELD: GND,
  })
const E0 = ESD_SS('TPD4EUSB30').source({ MPN: 'TPD4EUSB30DQAR' }).connect({ D1P: UP.TXCP, D1N: UP.TXCN, D2P: UP.RXP, D2N: UP.RXN, GND })
const E0B = USBLC6('USBLC6-2SC6').source({ MPN: 'USBLC6-2SC6', 'MPN:LCSC': 'C7519' }).connect({ IO1: UP.DN, IO2: UP.DP, GND, VBUS })
const C0TP = C100N().connect(UP.TXP, UP.TXCP)
const C0TN = C100N().connect(UP.TXN, UP.TXCN)
const R_CC1 = R0402('5.1k').source({ MPN: '0402WGF5101TCE', 'MPN:LCSC': 'C25905' }).connect(CC1, GND)
const R_CC2 = R0402('5.1k').source({ MPN: '0402WGF5101TCE', 'MPN:LCSC': 'C25905' }).connect(CC2, GND)
const C_VBUS = C0805('10u').source({ MPN: 'CL21A106KAYNNNE', 'MPN:LCSC': 'C15850' }).connect(VBUS, GND)
// VBUS detect: 90.9 k over 10 k into USB_VBUS
const R_VS1 = R0402('90.9k 1%').source({ MPN: '0402WGF9092TCE' }).connect(VBUS, VSENSE)
const R_VS2 = R0402('10k 1%').source({ MPN: '0402WGF1002TCE', 'MPN:LCSC': 'C25744' }).connect(VSENSE, GND)

// ---- clock, reference, reset
const Y1 = withPins(Crystal3225, { 1: 'X1', 3: 'X2', 2: 'GND', 4: 'GND' })('24MHz').source({ MPN: 'X322524MOB4SI' }).connect({ X1: XI, X2: XO, GND })
const R_XF = R0402('1M').source({ MPN: '0402WGF1004TCE', 'MPN:LCSC': 'C26083' }).connect(XI, XO)
const C_XI = C0402('18p').source({ MPN: '0402CG180J500NT' }).connect(XI, GND)
const C_XO = C0402('18p').source({ MPN: '0402CG180J500NT' }).connect(XO, GND)
const R_REF = R0402('9.53k 1%').source({ MPN: '0402WGF9531TCE' }).connect(RREF, GND)
// GANGED strapped high: one enable and one fault line for the four ports, two tracks round the board edge instead of eight
const R_GANG = R0402('10k').source({ MPN: '0402WGF1002TCE', 'MPN:LCSC': 'C25744' }).connect(V3V3, GANG)
const R_RST = R0402('10k').source({ MPN: '0402WGF1002TCE', 'MPN:LCSC': 'C25744' }).connect(V3V3, GRST)
const C_RST = C0402('1u').source({ MPN: 'CL05A105KA5NQNC', 'MPN:LCSC': 'C52923' }).connect(GRST, GND)

// ---- hub decoupling, on the back under the hub
const DEC12 = [0, 1, 2, 3].map(() => C100N().connect(V1V2, GND))
const DEC33 = [0, 1, 2, 3].map(() => C100N().connect(V3V3, GND))

// ---- power: 3.3 V LDO and 1.2 V buck from VBUS
const LDO = SOT23(5, { pinNames: ['VIN', 'GND', 'EN', 'NC', 'VOUT'] })('AP2112K-3.3')
  .source({ MPN: 'AP2112K-3.3TRG1', 'MPN:LCSC': 'C51118' })
  .connect({ VIN: VBUS, GND, EN: VBUS, VOUT: V3V3 })
const C_LDO_IN = C0603('1u').source({ MPN: 'CL10A105KB8NNNC', 'MPN:LCSC': 'C15849' }).connect(VBUS, GND)
const C_LDO_OUT = C0805('10u').source({ MPN: 'CL21A106KAYNNNE', 'MPN:LCSC': 'C15850' }).connect(V3V3, GND)
const BUCK = SOT23(5, { pinNames: ['EN', 'GND', 'SW', 'VIN', 'FB'] })('TLV62569')
  .source({ MPN: 'TLV62569DBVR' })
  .connect({ EN: VBUS, GND, SW, VIN: VBUS, FB })
const L1 = chip('L', '1206')('2.2u').source({ MPN: 'LQM31PN2R2M00L' }).connect(SW, V1V2)
const C_BUCK_IN = C0805('10u').source({ MPN: 'CL21A106KAYNNNE', 'MPN:LCSC': 'C15850' }).connect(VBUS, GND)
const C_BUCK_OUT = C1206('22u').source({ MPN: 'CL31A226KAHNNNE' }).connect(V1V2, GND)
// VOUT = 0.6 V x (1 + R1 / R2) = 1.2 V
const R_FB1 = R0402('100k 1%').source({ MPN: '0402WGF1003TCE', 'MPN:LCSC': 'C25741' }).connect(V1V2, FB)
const R_FB2 = R0402('100k 1%').source({ MPN: '0402WGF1003TCE', 'MPN:LCSC': 'C25741' }).connect(FB, GND)
const D_PWR = LED0603('blue').source({ MPN: 'LTST-C191TBKT' }).connect({ A: PLED, K: GND })
const R_PWR = R0402('1k').source({ MPN: '0402WGF1001TCE', 'MPN:LCSC': 'C11702' }).connect(V3V3, PLED)

const Y_CONN = 7.6 // Type-A centre: the mouth 0.73 mm over the top edge
const HX = 46,
  HY = 34.5 // hub centre
const SIG = { drill: 0.2, size: 0.45 }
const PWR = { drill: 0.3, size: 0.6 }
const T = 0.17 // track width of a pair, 90 ohm at a 0.15 mm gap on the 3313 prepreg
type Net = typeof GND

// a via at `at` and a short track from a pad to it
const drop = (pad: RouteEnd, net: Net, at: `${number} ${number}`, v = SIG, w = 0.2) => [via(net, at, v), route(pad).Z(at).width(w)]

type Port = (typeof PORTS)[number]

// One downstream port: receptacle to ESD array as pairs, through the array as single tracks, then on to the hub. The
// USB 2.0 lines cross under the receptacle, D- on B.Cu below D+, so that they reach the hub in its order.
function portRoutes({ J, ESS, E2, CTP, CTN, SW, CIN, COUT, RLED, LED, P, x, n }: Port) {
  const ex = x - (n === 2 ? 1 : 0) // the ESD array's x
  const hub = {
    1: [U1.TXP1, U1.TXM1, U1.RXP1, U1.RXM1, U1.DP1, U1.DM1],
    2: [U1.TXP2, U1.TXM2, U1.RXP2, U1.RXM2, U1.DP2, U1.DM2],
    3: [U1.TXP3, U1.TXM3, U1.RXP3, U1.RXM3, U1.DP3, U1.DM3],
    4: [U1.TXP4, U1.TXM4, U1.RXP4, U1.RXM4, U1.DP4, U1.DM4],
  }[n]!
  const g = `P${n}`
  // the USB 2.0 pair of ports 1 and 2 comes up from B.Cu through a via pair right above the hub pins
  const start = () => route([E2.pad('4'), E2.pad('6')]).V(23.8)
  const usb2 = (
    n === 1 ? start().X('49.8 28.3').via('F.Cu').Z([hub[4], hub[5]]) : n === 2 ? start().X('45.6 28.4').via('F.Cu').Z([hub[4], hub[5]]) : start().X([hub[4], hub[5]])
  ).priority(1)
  const vbus = via(P.VBUS, `${x + 3.75} 14.3`, PWR)
  return [
    // SuperSpeed TX: receptacle, AC capacitors, ESD, hub; ESD to hub is matched against RX
    route([J.SSTXP, J.SSTXN]).X([CTP[2], CTN[2]]).priority(2),
    route([CTP[1], CTN[1]])
      .X([ESS.pad('1'), ESS.pad('2')])
      .priority(2),
    route(ESS.pad('1')).Z(ESS.pad('10')).width(T),
    route(ESS.pad('2')).Z(ESS.pad('9')).width(T),
    (n === 1
      ? route([ESS.pad('10'), ESS.pad('9')])
          .V(26.4)
          .X([hub[0], hub[1]])
      : route([ESS.pad('10'), ESS.pad('9')]).X([hub[0], hub[1]])
    )
      .match(g)
      .priority(2),
    // SuperSpeed RX: receptacle, ESD, hub
    route([J.SSRXP, J.SSRXN])
      .X([ESS.pad('4'), ESS.pad('5')])
      .priority(2),
    route(ESS.pad('4')).Z(ESS.pad('7')).width(T),
    route(ESS.pad('5')).Z(ESS.pad('6')).width(T),
    (n === 1
      ? route([ESS.pad('7'), ESS.pad('6')])
          .V(27.2)
          .X([hub[2], hub[3]])
      : route([ESS.pad('7'), ESS.pad('6')])
          .V(26.2)
          .X([hub[2], hub[3]])
    )
      .match(g)
      .priority(2),
    // USB 2.0: D- drops to B.Cu under its pad, D+ crosses over it on F.Cu and drops beside the array on the back
    via(J.DN, `${x + 1.25} 18`, SIG),
    route(J.DN)
      .Z(`${x + 1.25} 18`)
      .width(T),
    route(`${x + 1.25} 18 B.Cu`)
      .H(x - 0.95)
      .Z(E2.pad('1'))
      .width(T),
    via(J.DP, `${x + 0.95} 18.75`, SIG),
    route(J.DP)
      .V(17.9)
      .Z(`${x + 0.95} 18.75`)
      .width(T),
    route(`${x + 0.95} 18.75 B.Cu`)
      .Z(E2.pad('3'))
      .width(T),
    route(E2.pad('3')).Z(E2.pad('4')).width(T),
    route(E2.pad('1')).Z(E2.pad('6')).width(T),
    usb2,
    // ESD grounds and supply: the array's ground pads sit between its lines, a via each
    // pads 3 and 8 are ground between the lines: a track up the middle to the via of the USB 2.0 array
    route(ESS.pad('8')).Z(ESS.pad('3')).width(0.15),
    route(ESS.pad('3'))
      .V(23)
      .H(ex - 0.2)
      .Z(`${x - 0.2} 20.55`)
      .width(0.15),
    drop(E2.GND, GND, `${x - 0.2} 20.55`),
    drop(E2.VBUS, VBUS, `${x + 0.27} 21.5`),
    // receptacle grounds and VBUS: vias in front of the pads, under the body
    drop(J.pad('4'), GND, `${x - 3.75} 14.4`),
    drop(J.pad('7'), GND, `${x} 14.4`),
    vbus,
    route(J.VBUS)
      .Z(`${x + 3.75} 14.3`)
      .width(0.6),
    // the port switch on the back under the receptacle: IN from the VBUS plane, OUT to the receptacle
    route(SW.OUT).X(vbus),
    route(COUT[1]).X(SW.OUT),
    route(RLED[1]).X(COUT[1]).width(0.25),
    drop(SW.IN, VBUS, `${x + 2.05} 6.5`, PWR, 0.6),
    route(CIN[1]).X(SW.IN),
    drop(SW.GND, GND, `${x + 3} 1.75`),
    route(CIN[2]).X(SW.GND).width(0.3),
    route(COUT[2])
      .X(`${x - 1} 6.3`)
      .width(0.6),
    via(GND, `${x - 1} 6.3`, PWR),
    route(RLED[2]).X(LED.A).width(0.2),
  ]
}

const VDD_VIAS = [
  [U1.pad('5'), 47.75, 29],
  [U1.pad('8'), 46.3, 29.3],
  [U1.pad('13'), 43.75, 29],
  [U1.pad('21'), 40.5, 32.75],
  [U1.pad('28'), 40.5, 36.25],
  [U1.pad('31'), 40.6, 37.75],
  [U1.pad('57'), 51.5, 34.25],
  [U1.pad('51'), 52, 37.6],
] as const
const VDD33_VIAS = [
  [U1.pad('16'), 42.1, 29],
  [U1.pad('34'), 42.75, 40],
  [U1.pad('52'), 51.35, 36.85],
  [U1.pad('63'), 51.9, 31.2],
] as const
// the back side end of a via in one of those lists
const back = (v: readonly [unknown, number, number]) => `${v[1]} ${v[2]} B.Cu` as const

export default (
  // skew 0.127 mm: the 5 mil intra-pair limit of TI's USB 3 layout guidance
  <PCB
    name="usb3-hub"
    revision="0.1.0"
    autoroute={{ layers: ['F.Cu', 'B.Cu'] }}
    classes={{
      ss: { impedance: 90, gap: 0.15, skew: 0.127, uncoupled: 8, via: SIG },
      usb: { impedance: 90, gap: 0.15, skew: 0.127, uncoupled: 10, via: SIG },
      power: { width: 0.6, via: PWR },
      rail: { width: 0.3, via: SIG },
    }}
  >
    <path layer="Edge.Cuts" d={roundedRect(W, H, 1)} />

    {PORTS.map(p => [
      <p.J at={`${p.x} ${Y_CONN} 180deg`} />,
      <p.E2 at={`${p.x} 21 90deg`} side="B" />,
      <p.ESS at={`${p.x - (p.n === 2 ? 1 : 0)} 25 -90deg`} />,
      <p.CTP at={`${p.x + 4.35} 20.6 90deg`} />,
      <p.CTN at={`${p.x + 3.15} 20.6 90deg`} />,
      <p.SW at={`${p.x + 3} 4 90deg`} side="B" />,
      <p.CIN at={`${p.x + 3} 7.6`} side="B" />,
      <p.COUT at={`${p.x - 1} 3.6 90deg`} side="B" />,
      <p.RLED at={`${p.x - 4} 4 90deg`} side="B" />,
      <p.LED at={`${p.x + (p.n % 2 ? -9 : 9)} ${p.n % 2 ? 3 : 6.5} 90deg`} />,
    ])}

    <U1 at={`${HX} ${HY} -90deg`} />
    <J0 at={`${W - 4.7} 35.5 90deg`} thermal={{ S3: 'solid' }} />
    <E0 at="57.4 33.9 180deg" />
    <E0B at="57 37.6" side="B" />
    <C0TP at="53.3 35.6" />
    <C0TN at="53.3 34.4" />
    <R_CC1 at="60 38.6 -90deg" />
    <R_CC2 at="59.5 29.5" />
    <C_VBUS at="66 42.2" />
    <R_VS1 at="53 42.3" />
    <R_VS2 at="50.5 42.3" />
    <R_GANG at="46.75 41.2 90deg" />
    <R_RST at="54 39.8" />
    <C_RST at="56.5 39.8" />

    <Y1 at="55.4 31.2 180deg" side="B" />
    <R_XF at="55.4 28.4" side="B" />
    <C_XI at="53.4 28.4" side="B" />
    <C_XO at="58.2 32.05 90deg" side="B" />
    <R_REF at="51.4 29.3" side="B" />
    {DEC12.map((C, i) => (
      <C at={['47.75 31.3 -90deg', '44 31.3 -90deg', '42.4 33.4', '42.4 36.25'][i]} side="B" />
    ))}
    {DEC33.map((C, i) => (
      <C at={['42.4 31.1 -90deg', '42.75 38.3 90deg', '49.6 37.3 180deg', '49.6 31.4 180deg'][i]} side="B" />
    ))}

    <BUCK at="30 41.2" />
    <L1 at="33.6 41.2 -90deg" />
    <C_BUCK_IN at="26.6 41.2 -90deg" />
    <C_BUCK_OUT at="36.6 41.2 -90deg" />
    <R_FB1 at="29 38.3" />
    <R_FB2 at="31.3 38.3" />
    <LDO at="20 41.2" />
    <C_LDO_IN at="17 41.2 -90deg" />
    <C_LDO_OUT at="23 41.2 -90deg" />
    <D_PWR at="12 41.2 90deg" />
    <R_PWR at="14.3 41.2 90deg" />

    {PORTS.map(portRoutes)}

    {/* upstream: RX on the rear row straight in; TX from the front row out to B.Cu, back under the rows and up between RX and
        USB 2.0; USB 2.0 down to B.Cu behind the rows, through its array on the back, up again at the hub */}
    {route([J0.A10, J0.A11])
      .X([E0.pad('4'), E0.pad('5')])
      .priority(2)}
    {/* the fan turns back past its own via on B.Cu, a loop of the pair's own copper */}
    {route([J0.B2, J0.B3])
      .h(1.6)
      .via('B.Cu')
      .h(0.8)
      .V(33)
      .H(60)
      .V(34.4)
      .H(59.5)
      .via('F.Cu')
      .Z([E0.pad('1'), E0.pad('2')])
      .priority(2)
      .loop()}
    {drop(J0.A6, UP.DP, '60.75 35.75', SIG, T)}
    {drop(J0.A7, UP.DN, '60.75 35.1', SIG, T)}
    {/* the array's pads are 1.9 mm apart and the vias 0.65 mm, so the fans differ by 1.6 mm with no run left for a bump;
        at 480 Mbps that is 10 ps of a 2 ns bit, so this short pair is allowed 1.8 mm */}
    {route(['60.75 35.75 B.Cu', '60.75 35.1 B.Cu'])
      .net(UP.DP, UP.DN)
      .H(59.6)
      .X([E0B.pad('3'), E0B.pad('1')])
      .priority(2)
      .skew(1.8)}
    {route(E0.pad('4')).Z(E0.pad('7')).width(T)}
    {route(E0.pad('5')).Z(E0.pad('6')).width(T)}
    {route(E0.pad('1')).Z(E0.pad('10')).width(T)}
    {route(E0.pad('2')).Z(E0.pad('9')).width(T)}
    {route(E0B.pad('3')).Z(E0B.pad('4')).width(T)}
    {route(E0B.pad('1')).Z(E0B.pad('6')).width(T)}
    {route([E0.pad('7'), E0.pad('6')])
      .X([U1.RXP_UP, U1.RXM_UP])
      .match('UP')
      .priority(2)}
    {/* TX takes a step down between the array and its capacitors, so that it has a run long enough to be matched to RX */}
    {route([E0.pad('10'), E0.pad('9')])
      .H(55.8)
      .V(36.76)
      .H(55.2)
      .V(35)
      .Z([C0TP[2], C0TN[2]])
      .match('UP')
      .priority(2)}
    {route([C0TP[1], C0TN[1]]).X([U1.TXP_UP, U1.TXM_UP]).priority(2)}
    {route([E0B.pad('4'), E0B.pad('6')])
      .X('51.9 36')
      .via('F.Cu')
      .Z([U1.DP_UP, U1.DM_UP])
      .priority(2)}
    {route(E0.pad('8')).Z(E0.pad('3')).width(0.2)}
    {drop(E0.pad('3'), GND, '58.6 33.9')}
    {/* the B row's D+ joins A6 in the gap between the rows, its D- joins A7 through B.Cu */}
    {route(J0.A6).Z(J0.B6).width(0.15)}
    {drop(J0.A7, UP.DN, '63.2 35.1', SIG, 0.15)}
    {drop(J0.B7, UP.DN, '64.75 36', SIG, 0.15)}
    {route('64.75 36 B.Cu').Z('63.2 35.1 B.Cu').net(UP.DN).width(0.15)}
    {route(J0.B1).Z(J0.S3).width(0.2)}
    {route(J0.B12).Z(J0.S2).width(0.2)}
    {drop(J0.A9, VBUS, '61.25 34.3', SIG, 0.3)}
    {drop(J0.A4, VBUS, '61.25 36.75', SIG, 0.3)}
    {drop(J0.B4, VBUS, '64.75 34.5', SIG, 0.3)}
    {drop(J0.B9, VBUS, '64.75 37', SIG, 0.3)}
    {drop(J0.B5, CC2, '65.45 35', SIG, 0.15)}
    {route('65.45 35 B.Cu').X(R_CC2[1]).net(CC2).width(0.15)}
    {route(J0.A5).H(60).Z(R_CC1[1]).width(0.15)}
    {drop(E0B.GND, GND, '57.6 37.6')}
    {drop(E0B.VBUS, VBUS, '56.4 37.6')}
    {route(C_VBUS[1]).X(J0.B9).width(0.6)}
    {route(R_VS1[1]).X(C_VBUS[1]).width(0.2)}
    {route(R_VS1[2]).X(R_VS2[1]).width(0.15)}
    {route(U1.USB_VBUS).X(R_VS2[1]).width(0.15)}

    {/* hub: supply pins to vias, the 1.2 V ones into the In2.Cu island, decoupling on the back */}
    {VDD_VIAS.map(([pad, x, y]) => drop(pad, V1V2, `${x} ${y}`, SIG, 0.2))}
    {VDD33_VIAS.map(([pad, x, y]) => drop(pad, V3V3, `${x} ${y}`, SIG, 0.2))}
    {DEC12.map((C, i) =>
      route(C[1])
        .X(back(VDD_VIAS[[0, 2, 3, 4][i]]))
        .net(V1V2)
        .width(0.25),
    )}
    {DEC33.map((C, i) =>
      route(C[1])
        .X(back(VDD33_VIAS[[0, 1, 2, 3][i]]))
        .net(V3V3)
        .width(0.25),
    )}
    {[...DEC12, ...DEC33].map(C => route(C[2]).X(U1.GND).width(0.25))}
    {drop(U1.XI, XI, '51.45 31.85', SIG, 0.15)}
    {drop(U1.XO, XO, '52 32.55', SIG, 0.15)}
    {drop(U1.USB_R1, RREF, '51.35 30.55', SIG, 0.15)}
    {route('51.45 31.85 B.Cu').X(Y1.X1).net(XI).width(0.15).layers(['B.Cu'])}
    {route('52 32.55 B.Cu').X(Y1.X2).net(XO).width(0.15).layers(['B.Cu'])}
    {route('51.35 30.55 B.Cu').X(R_REF[1]).net(RREF).width(0.15).layers(['B.Cu'])}
    {route(C_XI[1]).X(Y1.X1).width(0.15)}
    {route(C_XO[1]).X(Y1.X2).width(0.15)}
    {route(R_XF[1]).X(Y1.X1).width(0.15)}
    {route(R_XF[2]).X(Y1.X2).width(0.15)}
    {/* Y1.4 sat in a 4 mm² B.Cu piece fenced by the XI and XO tracks: a via down to the In1.Cu ground */}
    {drop(Y1[4], GND, '53.1 32.3')}
    {/* F.Cu ground pieces the tracks fence off by R8, C34 and R14: a via down to the In1.Cu ground in each */}
    {(['49.42 41.31', '39.24 39.44', '31.94 39.25'] as const).map(at => via(GND, at, SIG))}

    {route(U1.GRSTZ).X(R_RST[2]).width(0.15)}
    {route(R_RST[2]).X(C_RST[1]).width(0.15)}
    {route(U1.TEST).X(U1.GND).width(0.15)}

    {/* ganged switch control: down from the hub, along the bottom and right edges on B.Cu, then a bus over the four switches */}
    {route(U1.PWRCTL1).V(42.2).via('B.Cu').V(43.45).H(70.9).L(71.65, 42.7).V(1.4).L(70.85, 0.6).X(PORTS[0].SW.EN).width(0.15)}
    {route(U1.OVERCUR1Z).V(41.6).via('B.Cu').V(43.15).H(70.2).L(71.35, 42.05).V(1.5).L(70.75, 0.9).X(PORTS[0].SW.FLT).width(0.15)}
    {[0, 1, 2].map(i => [
      route(PORTS[i].SW.EN)
        .X(PORTS[i + 1].SW.EN)
        .width(0.15),
      route(PORTS[i].SW.FLT)
        .X(PORTS[i + 1].SW.FLT)
        .width(0.15),
    ])}
    {route(U1.GANGED).X(R_GANG[2]).width(0.15)}
    {route(R_GANG[1]).X(back(VDD33_VIAS[1])).net(V3V3).width(0.2)}

    {/* power: buck to 1.2 V on the In2.Cu island, LDO to 3.3 V */}
    {route(BUCK.SW).X(L1[1])}
    {route(L1[2]).X(C_BUCK_OUT[1])}
    {route(BUCK.VIN).X(C_BUCK_IN[1])}
    {route(BUCK.EN).X(BUCK.VIN).width(0.2)}
    {route(BUCK.FB).X(R_FB1[2]).width(0.15)}
    {route(R_FB1[2]).X(R_FB2[1]).width(0.15)}
    {route(R_FB1[1]).X(C_BUCK_OUT[1]).width(0.2)}
    {drop(C_BUCK_OUT[1], V1V2, '36.6 38.9', PWR, 0.6)}
    {drop(C_BUCK_IN[1], VBUS, '26.6 39.1', PWR, 0.6)}
    {route(LDO.VIN).X(C_LDO_IN[1])}
    {route(LDO.EN).X(LDO.VIN).width(0.3)}
    {route(LDO.VOUT).X(C_LDO_OUT[1])}
    {drop(C_LDO_IN[1], VBUS, '17 39.3', PWR, 0.6)}
    {route(C_LDO_OUT[1]).X(back(VDD33_VIAS[1])).net(V3V3)}
    {route(C_LDO_OUT[1]).X(R_RST[1])}
    {route(C_LDO_OUT[1]).X(back(VDD33_VIAS[0])).net(V3V3)}
    {route(back(VDD33_VIAS[3])).X(back(VDD33_VIAS[2])).net(V3V3)}
    {route(back(VDD33_VIAS[2])).X(R_RST[1]).net(V3V3)}
    {route(R_PWR[1]).X(C_LDO_OUT[1]).width(0.2)}
    {route(R_PWR[2]).X(D_PWR.A).width(0.2)}

    <text layer="F.SilkS" at="5.5 40.6" size={1.2}>
      usb3-hub
    </text>
    <text layer="F.SilkS" at="5.5 42.4" size={0.8}>
      rev 0.1.0
    </text>
    <text layer="F.SilkS" at="65.5 28.6" size={0.8}>
      UPSTREAM
    </text>
    {PORTS.map(p => (
      <text layer="F.SilkS" at={`${p.x - 2} 20.4`} size={1}>
        {String(p.n)}
      </text>
    ))}

    {/* pours: GND on both outer layers and In1.Cu, VBUS on In2.Cu with a 1.2 V island under the hub */}
    {pour(GND, 'F.Cu', rect(W, H), { connect: 'solid' })}
    {pour(GND, 'B.Cu', rect(W, H), { connect: 'solid' })}
    {pour(GND, 'In1.Cu', rect(W, H), { connect: 'solid' })}
    {pour(VBUS, 'In2.Cu', rect(W, H))}
    {pour(V1V2, 'In2.Cu', rect(27, 16, 29, 28), { priority: 1 })}
    <Brand at="10.6 33" height={6} />
  </PCB>
)
