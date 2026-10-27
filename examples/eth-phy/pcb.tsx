// eth-phy: a gigabit Ethernet PHY module. A KSZ9031RNX in a 7 x 7 mm QFN48 with a 25 MHz crystal drives an RJ45 magjack over
// four 100 ohm MDI pairs and talks RGMII to a host through a 2 x 20 header. Two LDOs make 3.3 V and 1.2 V from the header's 5 V.
// Four layers on the JLCPCB 7628 stackup: signals on F.Cu, GND on In1.Cu, 3.3 V and a 1.2 V island on In2.Cu, 3.3 V on B.Cu;
// In2.Cu and B.Cu also take the crossings. The PHY pinout follows the KSZ9031RNX datasheet; check it before ordering.
// Frame: mm, origin at the top-left corner of the outline, x right, y down. The jack mouth overhangs the left edge.
import PCB from '@pcbjs/fab/JLCPCB/4-Layer'
import { nets, route, pour, via, NC } from '@pcbjs/core'
import { Brand, QFN, SOT23, Crystal3225, R0603, C0402, C0603, LED0603, PinHeader, MountingHole, rect, roundedRect } from '@pcbjs/lib'
import { JLCPCB_4L_7628 } from '@pcbjs/lib/stackups'
import { MagJack } from './lib/MagJack'

const W = 56, H = 40

// JLC04161H-3313: the JLCPCB 1.6 mm four layer stack with 3313 prepreg, 0.0994 mm at er 4.1, and a 1.265 mm core. The thin
// prepreg brings a 50 ohm F.Cu track down to about 0.17 mm, narrow enough to leave a 0.5 mm pitch QFN without necking down.
const JLC_3313 = {
  ...JLCPCB_4L_7628,
  layers: JLCPCB_4L_7628.layers.map(l => l.type === 'prepreg' ? { ...l, material: '3313', thickness: 0.0994, er: 4.1 } : l.type === 'core' ? { ...l, thickness: 1.265 } : l),
}

const mdi = { class: 'mdi' } as const
const rgmii = { class: 'rgmii' } as const
const {
  GND, V5, V3V3, V1V2,
  MDI_AP, MDI_AN, MDI_BP, MDI_BN, MDI_CP, MDI_CN, MDI_DP, MDI_DN, CT,
  TXD0, TXD1, TXD2, TXD3, TX_CTL, TX_CLK, RXD0, RXD1, RXD2, RXD3, RX_CTL, RX_CLK,
  MDC, MDIO, INT_N, RESET_N, XI, XO, ISET, LED1, LED2, LED1A, LED2A, PWR,
} = nets({
  MDI_AP: mdi, MDI_AN: mdi, MDI_BP: mdi, MDI_BN: mdi, MDI_CP: mdi, MDI_CN: mdi, MDI_DP: mdi, MDI_DN: mdi,
  TXD0: rgmii, TXD1: rgmii, TXD2: rgmii, TXD3: rgmii, TX_CTL: rgmii, TX_CLK: rgmii,
  RXD0: rgmii, RXD1: rgmii, RXD2: rgmii, RXD3: rgmii, RX_CTL: rgmii, RX_CLK: rgmii,
})

// KSZ9031RNX, 48 pins counter-clockwise from the top of the left side: MDI on the left, RGMII TX on the bottom, RX on the
// right, crystal and bias on the top. Pads of one supply share a pin; each still gets its own via below.
const PHY_PINS = {
  1: 'AVDDH', 2: 'TXRXP_A', 3: 'TXRXM_A', 4: 'AVDDL', 5: 'TXRXP_B', 6: 'TXRXM_B', 7: 'TXRXP_C', 8: 'TXRXM_C', 9: 'AVDDL', 10: 'TXRXP_D', 11: 'TXRXM_D', 12: 'AVDDH',
  13: 'NC', 14: 'NC', 15: 'LED2', 16: 'DVDDH', 17: 'LED1', 18: 'DVDDL', 19: 'TXD0', 20: 'TXD1', 21: 'TXD2', 22: 'TXD3', 23: 'DVDDL', 24: 'GTX_CLK',
  25: 'TX_EN', 26: 'DVDDL', 27: 'RXD3', 28: 'RXD2', 29: 'DVDDL', 30: 'RXD1', 31: 'RXD0', 32: 'RX_DV', 33: 'DVDDH', 34: 'RX_CLK', 35: 'MDC', 36: 'MDIO',
  37: 'INT_N', 38: 'DVDDL', 39: 'DVDDH', 40: 'CLK125', 41: 'RESET_N', 42: 'LDO_O', 43: 'AVDDL_PLL', 44: 'XO', 45: 'XI', 46: 'NC', 47: 'ISET', 48: 'AVDDH',
  EP: 'GND',
} as const
const U1 = QFN(48, 7, 0.5, 5.6, { vias: 3, pinNames: PHY_PINS })('KSZ9031RNXCA').source({ MPN: 'KSZ9031RNXCA-TR' }).connect({
  AVDDH: V3V3, DVDDH: V3V3, AVDDL: V1V2, DVDDL: V1V2, AVDDL_PLL: V1V2, GND,
  TXRXP_A: MDI_AP, TXRXM_A: MDI_AN, TXRXP_B: MDI_BP, TXRXM_B: MDI_BN, TXRXP_C: MDI_CP, TXRXM_C: MDI_CN, TXRXP_D: MDI_DP, TXRXM_D: MDI_DN,
  TXD0, TXD1, TXD2, TXD3, GTX_CLK: TX_CLK, TX_EN: TX_CTL, RXD0, RXD1, RXD2, RXD3, RX_DV: RX_CTL, RX_CLK,
  MDC, MDIO, INT_N, RESET_N, XI, XO, ISET, LED1, LED2, CLK125: NC, LDO_O: NC,
})

const J1 = MagJack({ value: 'JK0654219NL', model: { file: './models/RJ45_Pulse_JK0654219NL_Horizontal.step', offset: [8.04, -6.5, 0], rotate: [0, 0, 180] } }).source({ MPN: 'JK0654219NL' }).connect({
  D1P: MDI_AP, D1N: MDI_AN, D2P: MDI_BP, D2N: MDI_BN, D3P: MDI_CP, D3N: MDI_CN, D4P: MDI_DP, D4N: MDI_DN,
  CT, L1A: LED1A, L1K: LED1, L2A: LED2A, L2K: LED2, SH: GND,
})

const Y1 = Crystal3225('25MHz').source({ MPN: 'ABM8-25.000MHZ-B2-T' }).connect({ X1: XI, X2: XO, GND })
const C1 = C0402('12p').source({ MPN: 'GRM1555C1H120JA01D' }).connect(XI, GND)
const C2 = C0402('12p').source({ MPN: 'GRM1555C1H120JA01D' }).connect(XO, GND)
const R1 = R0603('12.1k').source({ MPN: 'RC0603FR-0712K1L' }).connect(ISET, GND)
const R2 = R0603('10k').source({ MPN: 'RC0603FR-0710KL' }).connect(V3V3, RESET_N)
const R3 = R0603('1.5k').source({ MPN: 'RC0603FR-071K5L' }).connect(V3V3, MDIO)
const R4 = R0603('470').source({ MPN: 'RC0603FR-07470RL' }).connect(V3V3, LED1A)
const R5 = R0603('470').source({ MPN: 'RC0603FR-07470RL' }).connect(V3V3, LED2A)
const C3 = C0603('100n').source({ MPN: 'CL10B104KB8NNNC' }).connect(CT, GND)

// decoupling at the PHY: 100 nF per supply corner
const C4 = C0402('100n').source({ MPN: 'GRM155R71C104KA88D' }).connect(V3V3, GND)
const C5 = C0402('100n').source({ MPN: 'GRM155R71C104KA88D' }).connect(V1V2, GND)
const C6 = C0402('100n').source({ MPN: 'GRM155R71C104KA88D' }).connect(V3V3, GND)
const C7 = C0402('100n').source({ MPN: 'GRM155R71C104KA88D' }).connect(V1V2, GND)

// supplies: 5 V from the header into two AP2112K LDOs
const LDO = SOT23(5, { pinNames: ['VIN', 'GND', 'EN', 'NC', 'VOUT'] })
const U2 = LDO('AP2112K-3.3').source({ MPN: 'AP2112K-3.3TRG1' }).connect({ VIN: V5, GND, EN: V5, VOUT: V3V3 })
const U3 = LDO('AP2112K-1.2').source({ MPN: 'AP2112K-1.2TRG1' }).connect({ VIN: V3V3, GND, EN: V3V3, VOUT: V1V2 })
const C8 = C0603('1u').source({ MPN: 'CL10A105KB8NNNC' }).connect(V5, GND)
const C9 = C0603('1u').source({ MPN: 'CL10A105KB8NNNC' }).connect(V3V3, GND)
const C10 = C0603('1u').source({ MPN: 'CL10A105KB8NNNC' }).connect(V1V2, GND)
const D1 = LED0603('green').source({ MPN: 'LTST-C190GKT' }).connect({ A: PWR, K: GND })
const R6 = R0603('1k').source({ MPN: 'RC0603FR-071KL' }).connect(V3V3, PWR)

// the host header, pin 1 at the right end: signals on the odd row, nearer the PHY, ground and power on the even row
const HDR: Record<number, any> = {}
for (let i = 1; i <= 40; i++) HDR[i] = i % 2 ? NC : GND
Object.assign(HDR, {
  1: RX_CLK, 3: RX_CTL, 5: RXD0, 7: RXD1, 9: RXD2, 11: RXD3, 13: TX_CTL, 15: TX_CLK, 17: TXD3, 19: TXD2, 21: TXD1, 23: TXD0,
  25: MDIO, 27: MDC, 29: INT_N, 31: RESET_N, 36: V3V3, 38: V5, 40: V5,
})
const J2 = PinHeader(20, { rows: 2 }).source({ MPN: 'PZ254V-12-40P' }).connect(...Array.from({ length: 40 }, (_, i) => HDR[i + 1]))
const Hole = MountingHole(2.2)

// a short stub from a pad to a small via into a plane
const SMALL = { drill: 0.2, size: 0.45 }
const tie = (end: any, net: any, x: number, y: number, w = 0.25) => [route(end, `${x} ${y}`, 'Z').width(w), via(net, `${x} ${y}`, SMALL)]
// the 1.2 V island on In2.Cu: under the PHY, with a strip down to the 1.2 V LDO
const ISLAND = 'M 17 26 L 24 26 L 24 7.5 L 38.5 7.5 L 38.5 22 L 27 22 L 27 30.5 L 17 30.5 Z'

export default (
  <PCB name="eth-phy" revision="0.1.0" stackup={JLC_3313}
    classes={{ mdi: { impedance: 100, gap: 0.15, uncoupled: 8 }, rgmii: { impedance: 50, tolerance: 0.25 } }}
    autoroute={{ layers: ['F.Cu', 'In2.Cu', 'B.Cu'] }}>
    <path layer="Edge.Cuts" d={roundedRect(W, H, 1)} />
    {/* the PHY in the middle, the jack on the left edge, the host header along the bottom edge */}
    <U1 at="31 15" />
    <J1 at="9 14" />
    <J2 at="52.13 35.5 -90deg" />

    {/* crystal and bias above the PHY */}
    <Y1 at="30 5.5" />
    <C1 at="26.6 6.35" />
    <C2 at="33.6 4.65" />
    <R1 at="25.5 3.5 180deg" />
    <R2 at="36 7.5" />
    <R3 at="40 10" />

    {/* decoupling at the corners of the PHY */}
    <C4 at="22.5 9" />
    <C5 at="37.2 10.6" />
    <C6 at="24.8 20.6" />
    <C7 at="24.8 9" />

    {/* jack LEDs and centre taps */}
    <R4 at="12 4" />
    <R5 at="12 24" />
    <C3 at="21.5 20.5" />

    {/* supplies in the bottom left */}
    <U2 at="6 28" />
    <C8 at="2.5 28 90deg" />
    <C9 at="9.5 28 90deg" />
    <U3 at="15 28" />
    <C10 at="18.5 28 90deg" />
    <D1 at="23 28" />
    <R6 at="23 30.5" />

    <Hole ref="H1" at="53 3" />
    <Hole ref="H2" at="53 28" />

    {/* PHY supply pads: a stub out of each to its plane via, further out where RGMII lines pass on both sides */}
    {tie(U1.pad('1'), V3V3, 26.4, 12.25)}{tie(U1.pad('4'), V1V2, 25.9, 13.75)}{tie(U1.pad('9'), V1V2, 25.9, 16.25)}{tie(U1.pad('12'), V3V3, 26.4, 17.75)}
    {tie(U1.pad('16'), V3V3, 29.75, 19.6)}{tie(U1.pad('18'), V1V2, 30.75, 20.9)}{tie(U1.pad('23'), V1V2, 33.25, 20.9)}
    {tie(U1.pad('26'), V1V2, 36.9, 17.25)}{tie(U1.pad('29'), V1V2, 36.9, 15.75)}{tie(U1.pad('33'), V3V3, 36.9, 13.75)}
    {tie(U1.pad('38'), V1V2, 33.25, 9.5)}{tie(U1.pad('39'), V3V3, 32.6, 10.3)}{tie(U1.pad('43'), V1V2, 30.75, 10.4)}{tie(U1.pad('48'), V3V3, 28.25, 10.4)}
    {/* In2.Cu signals cut the 1.2 V island in three: B.Cu links join its AVDDL and DVDDL vias across the cuts */}{route('25.9 13.75 B.Cu', '25.9 16.25 B.Cu', 'Z').net(V1V2).width(0.25)}{route('30.75 20.9 B.Cu', '33.25 20.9 B.Cu', 'Z').net(V1V2).width(0.25)}

    {/* decoupling, crystal and bias: supply and ground vias */}
    {tie(C4[1], V3V3, 22.02, 8.0)}{tie(C4[2], GND, 22.98, 10.0)}
    {tie(C7[1], V1V2, 24.32, 8.0)}{tie(C7[2], GND, 25.28, 10.0)}
    {tie(C5[1], V1V2, 36.72, 9.6)}{tie(C5[2], GND, 37.68, 11.6)}
    {tie(C6[1], V3V3, 24.32, 19.6)}{tie(C6[2], GND, 25.28, 21.6)}
    {tie(Y1.pad('2'), GND, 30, 5.5)}{route(Y1.pad('4'), '30 5.5', 'Z').width(0.25)}
    {tie(C1[2], GND, 27.08, 7.4)}{tie(C2[2], GND, 35.1, 4.65)}{tie(R1[2], GND, 23.6, 3.5)}
    {tie(R2[1], V3V3, 35.18, 8.6)}{tie(R3[1], V3V3, 39.18, 9.0)}
    {route(Y1.X1, U1.XI)}{route(C1[1], Y1.X1)}
    {route(Y1.X2, U1.XO)}{route(C2[1], Y1.X2)}
    {route(U1.ISET, R1[1])}

    {/* the four MDI pairs, 100 ohm differential, from the PHY to just short of the jack. The jack pins of a pair sit in
        staggered rows, so the line square to them runs into the next pair's pins: the last 2 mm are single tracks. */}
    {([['A', 10.43, 'D1P', 'D1N'], ['B', 12.47, 'D2P', 'D2N'], ['C', 14.51, 'D3P', 'D3N'], ['D', 16.55, 'D4P', 'D4N']] as const).map(([k, y, p, n]) => [
      route([U1[`TXRXP_${k}`], U1[`TXRXM_${k}`]], [[20, y + 0.4], [20, y + 0.69]], `X 21.5 ${y + 0.545} Z`).impedance(100),
      route(`20 ${y + 0.4}`, J1.pin(p), 'Z').width(0.14),
      route(`20 ${y + 0.69}`, J1.pin(n), `L 19.4 ${y + 1.02} Z`).width(0.14),
    ])}

    {/* RGMII to the header, 50 ohm: the six TX lines matched as one group, the six RX lines as another, clocks included */}
    {route(U1.TXD0, J2[23]).match('TX')}
    {route(U1.TXD1, J2[21]).match('TX')}
    {route(U1.TXD2, J2[19]).match('TX')}
    {route(U1.TXD3, J2[17]).match('TX')}
    {route(U1.GTX_CLK, J2[15]).match('TX')}
    {route(U1.TX_EN, J2[13]).match('TX')}
    {route(U1.RXD3, J2[11]).match('RX')}
    {route(U1.RXD2, J2[9]).match('RX')}
    {route(U1.RXD1, J2[7]).match('RX')}
    {route(U1.RXD0, J2[5]).match('RX')}
    {route(U1.RX_DV, J2[3]).match('RX')}
    {route(U1.RX_CLK, J2[1]).match('RX')}

    {/* management and control, plain */}
    {route(U1.MDIO, R3[2])}{route(R3[2], J2[25])}
    {route(U1.MDC, J2[27])}
    {route(U1.INT_N, J2[29])}
    {route(U1.RESET_N, R2[2])}{route(R2[2], J2[31])}

    {/* jack LEDs, active low from the PHY, and the centre taps */}
    {route(U1.LED1, J1.L1K)}{route(R4[2], J1.L1A)}{tie(R4[1], V3V3, 10.1, 4)}
    {route(U1.LED2, J1.L2K)}{route(R5[2], J1.L2A)}{tie(R5[1], V3V3, 10.1, 24)}
    {route(J1.pad('10'), C3[1])}{route(J1.pad('1'), C3[1])}{tie(C3[2], GND, 22.33, 21.6)}

    {/* supplies: 5 V from the header into the 3.3 V LDO, 3.3 V into the 1.2 V LDO */}
    {route(J2[40], C8[1]).width(0.5)}{route(J2[38], J2[40], 'Z').width(0.5)}
    {route(C8[1], U2.VIN).width(0.4)}{route(U2.EN, C8[1]).width(0.3)}{tie(C8[2], GND, 2.5, 26.1, 0.4)}
    {tie(U2.GND, GND, 6, 28, 0.4)}
    {route(U2.VOUT, C9[1]).width(0.4)}{tie(C9[1], V3V3, 9.5, 30, 0.4)}{tie(C9[2], GND, 9.5, 26.1, 0.4)}
    {tie(U3.VIN, V3V3, 12.6, 27.05, 0.4)}{tie(U3.EN, V3V3, 12.6, 28.95, 0.3)}{tie(U3.GND, GND, 15, 28, 0.4)}
    {route(U3.VOUT, C10[1]).width(0.4)}{tie(C10[1], V1V2, 18.5, 29.9, 0.4)}{tie(C10[2], GND, 18.5, 26.1, 0.4)}
    {/* the In2.Cu strip to the LDO is cut off by the In2.Cu signal tracks: a 1.2 V track from C10 back to the PHY island */}{route(C10[1], U1.pad('9')).width(0.25)}
    {route(R6[2], D1.A, 'Z').width(0.25)}{tie(R6[1], V3V3, 21.1, 30.5)}{tie(D1.K, GND, 22.18, 29.1)}

    {/* planes: GND on In1.Cu, 3.3 V on In2.Cu with a 1.2 V island, 3.3 V on B.Cu */}
    {/* laid out for solid planes: the connector rows and fine-pitch pads would starve thermal reliefs */}
    {pour(GND, 'In1.Cu', rect(W, H), { connect: 'solid' })}
    {pour(V3V3, 'In2.Cu', rect(W, H), { connect: 'solid' })}
    {pour(V1V2, 'In2.Cu', ISLAND, { priority: 1, connect: 'solid' })}
    {pour(V3V3, 'B.Cu', rect(W, H), { connect: 'solid' })}

    <text layer="F.SilkS" at="44 3" size={1}>eth-phy</text>
    <text layer="F.SilkS" at="44 4.6" size={0.7}>rev 0.1.0</text>
    <Brand at="41.6 31" height={5} layer="B.SilkS" />
  </PCB>
)
