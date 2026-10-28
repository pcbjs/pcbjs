// usb-hub: a bus powered four port USB 2.0 hub, 50 x 30 mm, JLCPCB two layer. Upstream USB-C on the bottom edge, four
// downstream USB-C receptacles on the top edge, a QFN-28 hub controller in the middle with a 12 MHz crystal, a 3.3 V LDO,
// and a USBLC6-2SC6 ESD array in the data path of every port.
// Frame: millimetres, origin at the top-left corner of the outline, x right, y down.
import PCB from '@pcbjs/fab/JLCPCB/2-Layer'
import { nets, local, route, pour, via, NC } from '@pcbjs/core'
import { twoLayer } from '@pcbjs/lib/stackups'
import { Brand, USBC, SOT23, QFN, Crystal3225, withPins, R0402, C0402, C0603, rect, roundedRect } from '@pcbjs/lib'

const W = 50,
  H = 30
const usb = { class: 'usb' } as const,
  power = { class: 'power' } as const

const { GND, VBUS, V3V3, XI, XO, RST, RREF, OVCUR, D0P, D0N, D1P, D1N, D2P, D2N, D3P, D3N, D4P, D4N } = nets({
  GND: power,
  VBUS: power,
  V3V3: power,
  D0P: usb,
  D0N: usb,
  D1P: usb,
  D1N: usb,
  D2P: usb,
  D2N: usb,
  D3P: usb,
  D3N: usb,
  D4P: usb,
  D4N: usb,
})

// the hub controller: a QFN-28 5 x 5 mm, 0.5 mm pitch: upstream on the left side, ports 1 to 3 on the top side, port 4 and the
// crystal on the right side, supplies on the bottom. The pin map is laid out for this board, modelled on GL850G class hubs.
const HUB_PINS = {
  1: 'VDD1',
  2: 'VDDA',
  3: 'DM0',
  4: 'DP0',
  5: 'RREF',
  6: 'RST',
  7: 'NC',
  8: 'NC',
  9: 'NC',
  10: 'VDD2',
  11: 'VDD3',
  12: 'OVCUR',
  13: 'NC',
  14: 'PWREN',
  15: 'NC',
  16: 'NC',
  17: 'XO',
  18: 'XI',
  19: 'NC',
  20: 'DM4',
  21: 'DP4',
  22: 'VDD4',
  23: 'DM3',
  24: 'DP3',
  25: 'DM2',
  26: 'DP2',
  27: 'DM1',
  28: 'DP1',
  EP: 'GND',
} as const
const U1 = QFN(28, 5, 0.5, 3.1, { pinNames: HUB_PINS, vias: 2 })('GL850G').source({ MPN: 'GL850G-OHY50' }).connect({
  DM1: D1N,
  DP1: D1P,
  VDD1: V3V3,
  XI,
  XO,
  VDDA: V3V3,
  RST,
  DM0: D0N,
  DP0: D0P,
  RREF,
  VDD2: V3V3,
  PWREN: NC,
  OVCUR,
  VDD3: V3V3,
  DM4: D4N,
  DP4: D4P,
  DP3: D3P,
  DM3: D3N,
  VDD4: V3V3,
  DP2: D2P,
  DM2: D2N,
  GND,
})

// clock: a 12 MHz crystal with its two load capacitors
const Y1 = withPins(Crystal3225, { 1: 'X1', 3: 'X2', 2: 'GND', 4: 'GND' })('12MHz').source({ MPN: 'X322512MSB4SI', 'MPN:LCSC': 'C9002' }).connect({ X1: XI, X2: XO, GND })
const C_XI = C0402('22p').source({ MPN: 'CL05C220JB5NNNC', 'MPN:LCSC': 'C1555' }).connect(XI, GND)
const C_XO = C0402('22p').source({ MPN: 'CL05C220JB5NNNC', 'MPN:LCSC': 'C1555' }).connect(XO, GND)

// 3.3 V regulator from VBUS
const LDO = SOT23(5, { pinNames: ['VIN', 'GND', 'EN', 'NC', 'VOUT'] })('AP2112K-3.3')
  .source({ MPN: 'AP2112K-3.3TRG1', 'MPN:LCSC': 'C51118' })
  .connect({ VIN: VBUS, GND, EN: VBUS, VOUT: V3V3 })
const C_IN = C0603('10u').source({ MPN: 'CL10A106KP8NNNC', 'MPN:LCSC': 'C19702' }).connect(VBUS, GND)
const C_OUT = C0603('10u').source({ MPN: 'CL10A106KP8NNNC', 'MPN:LCSC': 'C19702' }).connect(V3V3, GND)

// hub pull ups, reset and reference, decoupling
const R_RST = R0402('10k').source({ MPN: '0402WGF1002TCE', 'MPN:LCSC': 'C25744' }).connect(V3V3, RST)
const C_RST = C0402('100n').source({ MPN: 'CL05B104KO5NNNC', 'MPN:LCSC': 'C1525' }).connect(RST, GND)
const R_OC = R0402('10k').source({ MPN: '0402WGF1002TCE', 'MPN:LCSC': 'C25744' }).connect(V3V3, OVCUR)
const R_REF = R0402('2.7k 1%').source({ MPN: '0402WGF2701TCE', 'MPN:LCSC': 'C25907' }).connect(RREF, GND)
const DEC = [1, 2, 3, 4, 5].map(() => C0402('100n').source({ MPN: 'CL05B104KO5NNNC', 'MPN:LCSC': 'C1525' }).connect(V3V3, GND))

// USBLC6-2SC6: I/O 1 on pins 1 and 6, I/O 2 on pins 3 and 4, flow through
const ESD = SOT23(6, { pinNames: { 1: 'IO1', 6: 'IO1', 3: 'IO2', 4: 'IO2', 2: 'GND', 5: 'VBUS' } })
const RECEPTACLE = USBC.footprint('full16')

// upstream: a sink, so 5.1 k pull downs on CC
const { UCC1, UCC2 } = nets()
const J1 = RECEPTACLE('TYPE-C-31-M-12')
  .source({ MPN: 'TYPE-C-31-M-12', 'MPN:LCSC': 'C165948' })
  .connect({ GND, VBUS, CC1: UCC1, CC2: UCC2, DP: D0P, DN: D0N, SBU1: NC, SBU2: NC, SHIELD: GND })
const R_UCC1 = R0402('5.1k').source({ MPN: '0402WGF5101TCE', 'MPN:LCSC': 'C25905' }).connect(UCC1, GND)
const R_UCC2 = R0402('5.1k').source({ MPN: '0402WGF5101TCE', 'MPN:LCSC': 'C25905' }).connect(UCC2, GND)
const U3 = ESD('USBLC6-2SC6').source({ MPN: 'USBLC6-2SC6', 'MPN:LCSC': 'C7519' }).connect({ IO1: D0P, IO2: D0N, GND, VBUS })

// downstream: sources, so 56 k pull ups on CC advertise default USB power
const PAIRS = [
  [D1P, D1N],
  [D2P, D2N],
  [D3P, D3N],
  [D4P, D4N],
] as const
const PORTS = PAIRS.map(([P, N], i) => {
  const { CC1, CC2 } = local(`P${i + 1}`)
  return {
    J: RECEPTACLE('TYPE-C-31-M-12').source({ MPN: 'TYPE-C-31-M-12', 'MPN:LCSC': 'C165948' }).connect({ GND, VBUS, CC1, CC2, DP: P, DN: N, SBU1: NC, SBU2: NC, SHIELD: GND }),
    R1: R0402('56k').source({ MPN: '0402WGF5602TCE', 'MPN:LCSC': 'C25796' }).connect(VBUS, CC1),
    R2: R0402('56k').source({ MPN: '0402WGF5602TCE', 'MPN:LCSC': 'C25796' }).connect(VBUS, CC2),
    E: ESD('USBLC6-2SC6').source({ MPN: 'USBLC6-2SC6', 'MPN:LCSC': 'C7519' }).connect({ IO1: P, IO2: N, GND, VBUS }),
  }
})
const PORT_X = [7, 19, 31, 43]

const SMALL = { drill: 0.2, size: 0.45 }
type Recept = typeof J1

// The A and B contacts of DP and DN of a USB-C receptacle join on B.Cu behind the pad row: a stub from each pad to a via,
// a link between. c is the receptacle centre, u the unit along the pad row, v the unit from the centre towards the pads.
function joinAB(J: Recept, c: [number, number], u: [number, number], v: [number, number], P: typeof D0P, N: typeof D0P) {
  const r2 = (n: number) => Math.round(n * 100) / 100
  const at = (o: number, d: number): [number, number] => [r2(c[0] + u[0] * o + v[0] * d), r2(c[1] + u[1] * o + v[1] * d)]
  const back = (o: number, d: number): [number, number, string] => [...at(o, d), 'B.Cu']
  const ends = [
    ['B6', P, -0.75, 2.8],
    ['A6', P, 0.25, 2.8],
    ['A7', N, -0.25, 2.0],
    ['B7', N, 0.75, 2.0],
  ] as const
  return [
    ...ends.map(([pad, net, o, d]) => [route(J[pad], at(o, d), 'Z').width(0.2), via(net, at(o, d), SMALL)]),
    route(back(-0.75, 2.8), back(0.25, 2.8), 'Z').net(P).width(0.2),
    route(back(-0.25, 2.0), back(0.75, 2.0), 'Z').net(N).width(0.2),
  ]
}

// 90 ohm differential on F.Cu needs 1.10 mm tracks over the 1.51 mm core of the 1.6 mm board, wider than the 0.5 mm pitch of
// the USB-C and QFN pads. JLCPCB builds two layer boards 0.4 mm thick, where 90 ohm with a 0.15 mm gap is 0.34 mm tracks.
const STACKUP = twoLayer({ thickness: 0.4, finish: 'HASL' })
const PX = PORT_X

export default (
  <PCB
    name="usb-hub"
    revision="0.1.0"
    stackup={STACKUP}
    classes={{
      usb: { impedance: 90, gap: 0.15, skew: 0.1, uncoupled: 10, via: { drill: 0.2, size: 0.45 } },
      power: { width: 0.5, via: { drill: 0.3, size: 0.6 } },
    }}
  >
    <path layer="Edge.Cuts" d={roundedRect(W, H, 1)} />

    {/* upstream on the left edge, its ESD array beside it, the CC pull downs above and below the pair */}
    <J1 at="3.4 21.5 -90deg" />
    <U3 at="11.4 22 180deg" />
    <R_UCC1 at="11 19.4" />
    <R_UCC2 at="11.2 24.6" />

    {/* downstream on the top edge, each with its ESD array and CC pull ups below the contacts */}
    {PORTS.map((p, i) => [
      <p.J at={`${PX[i]} 3.4 180deg`} />,
      <p.E at={`${PX[i] - 0.5} 11.9 90deg`} />,
      <p.R1 at={`${PX[i] + 3.1} 11 -90deg`} />,
      <p.R2 at={`${PX[i] - 3.1} 11 -90deg`} />,
    ])}

    {/* the hub, its crystal on the right, reset and reference on the left, decoupling at each supply pin */}
    <U1 at="27 20" />
    <Y1 at="33.5 23.5 180deg" />
    <C_XI at="36.7 22.65" />
    <C_XO at="32.4 26.3 -90deg" />
    <R_REF at="22.8 21.4 180deg" />
    <R_RST at="22.8 22.6" />
    {/* turned so its GND pad faces the open pour on the right: at 180deg the 3V3 track fenced it into a 1 mm² piece */}
    <C_RST at="22.8 23.8" />
    <R_OC at="28.6 24.5 90deg" />
    {DEC.map((C, i) => (
      <C at={['22.6 17.2 180deg', '22.6 18.5 180deg', '25.8 24.5 -90deg', '27.2 24.5 -90deg', '31.2 16.4'][i]} />
    ))}

    {/* power: the LDO and its capacitors along the bottom edge */}
    <LDO at="17 26.6" />
    <C_IN at="14 26.6 90deg" />
    <C_OUT at="19.8 26.6 90deg" />

    {/* data: every pair from its receptacle into its ESD array, straight through the array, then on to the hub */}
    {joinAB(J1, [3.4, 21.5], [0, -1], [1, 0], D0P, D0N)}
    {route([J1.B6, J1.A7], [U3.pad('6'), U3.pad('4')], 'Z').impedance(90)}
    {route(U3.pad('6'), U3.pad('1'), 'Z').width(0.27)}
    {route(U3.pad('4'), U3.pad('3'), 'Z').width(0.27)}
    {/* upstream: through a via pair to B.Cu under the VBUS spine and back */}
    {route([U3.pad('1'), U3.pad('3')], [U1.DP0, U1.DM0], 'H 15 @B.Cu H 18 @F.Cu H 20 L 22.25 19.75 Z').impedance(90)}
    {PORTS.map(({ J, E }, i) => [
      joinAB(J, [PX[i], 3.4], [1, 0], [0, 1], PAIRS[i][0], PAIRS[i][1]),
      route([J.B6, J.A7], [E.pad('6'), E.pad('4')], 'Z').impedance(90),
      route(E.pad('6'), E.pad('1'), 'Z').width(0.27),
      route(E.pad('4'), E.pad('3'), 'Z').width(0.27),
    ])}
    {/* the hub legs, drawn as centre lines: ports 1 and 2 nest on the left, port 3 comes from the right, port 4 to the right side */}
    {route([PORTS[0].E.pad('1'), PORTS[0].E.pad('3')], [U1.DP1, U1.DM1], 'V 16 H 25.15 L 25.75 16.6 Z').impedance(90)}
    {route([PORTS[1].E.pad('1'), PORTS[1].E.pad('3')], [U1.DP2, U1.DM2], 'V 14.9 H 25.6 L 26.75 16.05 Z').impedance(90)}
    {route([PORTS[2].E.pad('1'), PORTS[2].E.pad('3')], [U1.DP3, U1.DM3], 'V 14 L 27.75 16.75 Z').impedance(90)}
    {route([PORTS[3].E.pad('1'), PORTS[3].E.pad('3')], [U1.DP4, U1.DM4], 'V 17.75 L 43 18.75 H 40 @B.Cu H 37 @F.Cu Z').impedance(90)}

    {/* VBUS: a rail on B.Cu across the top, under the ESD arrays, a via below each VBUS contact of the downstream ports, and a
        spine down the left to the upstream receptacle and the LDO */}
    {route('4.55 9.1 B.Cu', '45.45 9.1 B.Cu', 'Z').net(VBUS)}
    {route('9 9.1 B.Cu', '9 25.2 B.Cu', 'Z').net(VBUS)}
    {PORTS.map(({ J, E, R1, R2 }, i) => {
      const x = PX[i]
      return [
        via(VBUS, `${x - 2.45} 9.1`),
        via(VBUS, `${x + 2.45} 9.1`),
        route(J.B4, `${x - 2.45} 9.1`, 'Z'),
        route(J.A4, `${x + 2.45} 9.1`, 'Z'),
        // the array's supply and ground pins sit between its signal pins: a via each inside the body
        route(E.VBUS, `${x - 0.85} 11.9`, 'Z').width(0.2),
        via(VBUS, `${x - 0.85} 11.9`, SMALL),
        route(`${x - 0.85} 11.9 B.Cu`, `${x - 0.85} 9.1 B.Cu`, 'Z')
          .net(VBUS)
          .width(0.3),
        route(E.GND, `${x - 0.15} 11.9`, 'Z').width(0.2),
        via(GND, `${x - 0.15} 11.9`, SMALL),
        route(R1[1], `${x + 2.45} 9.1`).width(0.3),
        route(R1[2], J.CC1).width(0.2),
        route(R2[1], `${x - 2.45} 9.1`).width(0.3),
        route(R2[2], J.CC2).width(0.2),
      ]
    })}
    {via(VBUS, '9 19.05')}
    {route(J1.A4, '9 19.05', 'Z')}
    {via(VBUS, '9 25.2')}
    {route(J1.B4, '9 25.2')}
    {route(U3.VBUS, '11.4 21.65', 'Z').width(0.2)}
    {via(VBUS, '11.4 21.65', SMALL)}
    {route('11.4 21.65 B.Cu', '9 21.65 B.Cu', 'Z').net(VBUS).width(0.3)}
    {route(U3.GND, '11.4 22.35', 'Z').width(0.2)}
    {via(GND, '11.4 22.35', SMALL)}
    {route(J1.CC1, R_UCC1[1]).width(0.2)}
    {route(J1.CC2, R_UCC2[1]).width(0.2)}
    {route('9 25.2', C_IN[1])}
    {route(C_IN[1], LDO.VIN)}
    {route(LDO.EN, C_IN[1])}

    {/* 3.3 V: LDO to its output capacitor, then along the bottom of the hub to every supply pin's capacitor */}
    {route(LDO.VOUT, C_OUT[1])}
    {[
      [C_OUT[1], DEC[2][1]],
      [DEC[2][1], DEC[3][1]],
      [DEC[3][1], R_OC[1]],
      [DEC[2][1], R_RST[1]],
      [R_RST[1], DEC[1][1]],
      [DEC[1][1], DEC[0][1]],
      [DEC[3][1], DEC[4][1]],
    ].map(([a, b]) => route(a, b))}
    {route(U1.VDD1, DEC[0][1]).width(0.2)}
    {route(U1.VDDA, DEC[1][1]).width(0.2)}
    {route(U1.VDD2, DEC[2][1]).width(0.2)}
    {route(U1.VDD3, DEC[3][1]).width(0.2)}
    {route(U1.VDD4, DEC[4][1]).width(0.2)}

    {/* the hub's small signals */}
    {route(U1.XI, Y1.X1).width(0.2)}
    {route(Y1.X1, C_XI[1]).width(0.2)}
    {route(U1.XO, Y1.X2).width(0.2)}
    {route(Y1.X2, C_XO[1]).width(0.2)}
    {route(U1.RST, R_RST[2]).width(0.2)}
    {route(R_RST[2], C_RST[1]).width(0.2)}
    {route(U1.RREF, R_REF[1]).width(0.2)}
    {route(U1.OVCUR, R_OC[2]).width(0.2)}

    {/* laid out for solid pours: the connector and the fine-pitch pads would starve thermal reliefs */}
    {pour(GND, 'F.Cu', rect(W, H), { connect: 'solid' })}
    {pour(GND, 'B.Cu', rect(W, H), { connect: 'solid' })}

    <text layer="F.SilkS" at="41.5 25" size={1.2}>
      usb-hub
    </text>
    <text layer="F.SilkS" at="41.5 27" size={0.8}>
      rev 0.1.0 4 x USB 2.0
    </text>
    <text layer="F.SilkS" at="4 14.6" size={0.8}>
      UPSTREAM
    </text>
    {/* the port 2 label sits 0.5 mm higher to leave room for the skew bump on its hub leg below */}
    {PX.map((x, i) => (
      <text layer="F.SilkS" at={`${x + 3.4} ${i === 1 ? 12.9 : 13.4}`} size={1}>
        {String(i + 1)}
      </text>
    ))}
    <Brand at="39.35 25.75" height={5} layer="B.SilkS" />
  </PCB>
)
