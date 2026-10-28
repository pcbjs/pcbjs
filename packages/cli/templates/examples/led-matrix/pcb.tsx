// LED matrix: N x N WS2812B-2020 pixels on a two-layer board, chained in a serpentine from J1 at the top to J2 at the bottom.
// Frame: millimetres, origin at the top-left corner of the outline, x right, y down.
// PCB_N sets N. The target is 16, but the default is 8 because 16 takes many minutes to compile.
import PCB from '@pcbjs/fab/JLCPCB/2-Layer'
import { nets, bus, route, pour, via } from '@pcbjs/core'
import { Brand, PinHeader, R0603, C0805, rect, roundedRect } from '@pcbjs/lib'
import { pixel, PixelCell, PITCH, type Step } from './lib/pixel'

const N = Number(process.env.PCB_N ?? 8)
const STRIP = 8 // header strip above and below the matrix
const AUTO_ROW = process.env.PCB_AUTOROW === '1' // hand row 0 of the data chain to the autorouter, for comparison
const W = N * PITCH
const H = N * PITCH + 2 * STRIP

// Nets: 5 V on the front pour, GND on the back pour, the data chain D0 to D<N*N>.
const { V5, GND, DATA } = nets()
const D = bus('D', N * N + 1)

// Power and data in, data out.
const J1 = PinHeader(4).source({ MPN: 'PZ254V-11-04P', 'MPN:LCSC': 'C492403' }).connect(V5, DATA, GND, GND)
const J2 = PinHeader(4)
  .source({ MPN: 'PZ254V-11-04P', 'MPN:LCSC': 'C492403' })
  .connect(V5, D[N * N], GND, GND)
const R1 = R0603('33').source({ MPN: 'RC0603FR-0733RL', 'MPN:LCSC': 'C23140' }).connect(DATA, D[0])
const C1 = C0805('22u').source({ MPN: 'CL21A226MAQNNNE', 'MPN:LCSC': 'C45783' }).connect(V5, GND)

// Pixels in chain order: row r, column c; odd rows run right to left and are turned 180deg.
type Cell = { g: ReturnType<typeof pixel>; x: number; y: number; rot: number; step: Step }
const cells: Cell[] = []
for (let r = 0; r < N; r++) {
  for (let k = 0; k < N; k++) {
    const i = r * N + k
    const odd = r % 2 === 1
    const c = odd ? N - 1 - k : k
    const g = pixel({ VDD: V5, GND, DIN: D[i], DOUT: D[i + 1] }, `P${r}_${c}`)
    const last = i === N * N - 1
    const step: Step = last || (AUTO_ROW && r === 0 && k < N - 1) ? 'end' : k < N - 1 ? 'right' : odd ? 'up' : 'down'
    cells.push({ g, x: (c + 0.5) * PITCH, y: STRIP + (r + 0.5) * PITCH, rot: odd ? 180 : 0, step })
  }
}
const first = cells[0].g
const lastPx = cells[cells.length - 1].g

export default (
  <PCB name="LedMatrix" revision="0.1.0">
    <path layer="Edge.Cuts" d={roundedRect(W, H, 2)} />

    {/* input: J1 on the top strip, the series resistor and the bulk cap next to it */}
    <J1 at="12 4 90deg" />
    <R1 at="4 4" />
    <C1 at="24 4" />
    {route(J1[2], R1[1], 'XZ').width(0.25)}
    {route(R1[2], first.LED.DIN, 'XZ').width(0.2)}
    {route(C1[2], '25.5 4', 'Z').width(0.4)}
    {via(GND, '25.5 4')}

    {/* the matrix */}
    {cells.map(({ g, x, y, rot, step }) => (
      <PixelCell g={g} at={`${x} ${y} ${rot}deg`} step={step} />
    ))}

    {/* row 0 autorouted pixel to pixel when AUTO_ROW is set */}
    {AUTO_ROW && cells.slice(0, N - 1).map(({ g }, i) => route(g.LED.DOUT, cells[i + 1].g.LED.DIN, 'XZ').width(0.2))}

    {/* output: J2 on the bottom strip */}
    <J2 at={`12 ${H - 4} 90deg`} />
    {route(lastPx.LED.DOUT, J2[2], 'XZ').width(0.2)}

    {/* pours: 5 V on the front, GND on the back */}
    {pour(V5, 'F.Cu', rect(W, H))}
    {pour(GND, 'B.Cu', rect(W, H))}

    <text layer="F.SilkS" at={`${W * 0.75} ${H - 4}`} size={N >= 8 ? 1.5 : 0.8}>{`LED MATRIX ${N}x${N}`}</text>
    {/* the brand in the top strip's free right end, which only the 8 x 8 board and larger have */}
    {N >= 8 && <Brand at={`${W - 11} 4`} height={5} />}
  </PCB>
)
