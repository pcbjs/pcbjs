// The QFN breakout board as a function, so pcb.tsx and tangled.tsx build the same board with the headers either way round.
// Frame: mm, origin at the top-left corner of the outline, x right, y down.
import PCB from '@pcbjs/fab/JLCPCB/2-Layer'
import { nets, route, pour, type Net } from '@pcbjs/core'
import { Brand, QFN, PinHeader, C0402, rect } from '@pcbjs/lib'

export interface BreakoutOptions {
  name: string
  /** turn every header end for end, so each header carries its side in reverse and every line crosses the other 15 */
  tangle?: boolean
  /** the sides, 0 left, 1 bottom, 2 right, 3 top, whose routes take the staircase path instead of a bare route(a, b) */
  stair?: number[]
  /** the autoroute rip up count, else the default */
  ripup?: number
}

const W = 50
const C = W / 2
const span = 15 * 2.54
const e = C - span / 2

// The staircase, worked out for the left side and turned a quarter turn per side: a F.Cu stub out of the pad to a via,
// a B.Cu run along the side to the height of the header pin, a via, and an automatic leg to the pin. The pins bound for
// the corners take the columns nearest the header, so each side stays inside its own wedge and the sides never meet.
const rank = [10, 7, 1, 16, 2, 15, 9, 8, 3, 14, 4, 13, 5, 12, 6, 11]
const turn = (side: number, x: number, y: number) => {
  let [dx, dy] = [x - C, y - C]
  for (let q = 0; q < side; q++) [dx, dy] = [dy, -dx]
  return `${(C + dx).toFixed(4)} ${(C + dy).toFixed(4)}`
}
function stair(n: number) {
  const side = Math.floor((n - 1) / 16),
    k = ((n - 1) % 16) + 1
  const x = 3.5 + 0.7 * rank.indexOf(k)
  const y = C - 3.75 + 0.5 * (k - 1)
  const Y = e + 2.54 * (16 - k)
  return `L ${turn(side, x, y)} @B.Cu L ${turn(side, x, Y)} @F.Cu XZ`
}

export function breakout({ name, tangle = false, stair: stairSides = [], ripup }: BreakoutOptions) {
  // QFN pin n sits on side floor((n-1)/16): 0 left, 1 bottom, 2 right, 3 top. The first pin of a side is VDD, the last GND.
  const N = nets()
  const { VDD, GND } = N
  const netOf = (n: number): Net => ((n - 1) % 16 === 0 ? VDD : (n - 1) % 16 === 15 ? GND : N[`S${n}`])

  const U1 = QFN(64, 9, 0.5, 5.2, { vias: 3, pinNames: { EP: 'GND' } })('QFN64-9x9').connect(
    Object.fromEntries([...Array.from({ length: 64 }, (_, i) => [i + 1, netOf(i + 1)]), ['GND', GND]]),
  )

  // Header k carries side k, pin i the i-th QFN pin of the side in the order the header runs along the edge.
  const order = [
    (i: number) => i, // left: QFN 1..16 run down, header pins run down
    (i: number) => 16 + i, // bottom: QFN 17..32 run right, header pins run right
    (i: number) => 48 - i + 1, // right: QFN 33..48 run up, header pins run down
    (i: number) => 64 - i + 1, // top: QFN 49..64 run left, header pins run right
  ]
  const headers = order.map(f =>
    PinHeader(16)
      .source({ MPN: 'PZ254V-11-16P' })
      .connect(...Array.from({ length: 16 }, (_, i) => netOf(f(i + 1)))),
  )
  const [JL, JB, JR, JT] = headers
  const pinOf = (n: number) => {
    const f = order[Math.floor((n - 1) / 16)]
    return Array.from({ length: 16 }, (_, j) => j + 1).find(j => f(j) === n)!
  }

  // One 100 nF per corner, between the VDD of one side and the GND of the next.
  const corners = [
    [1, 64],
    [17, 16],
    [33, 32],
    [49, 48],
  ]
  const caps = corners.map(([v, g]) => C0402('100n').source({ MPN: 'CL05B104KO5NNNC', 'MPN:LCSC': 'C1525' }).connect(netOf(v), netOf(g)))

  // tangled: pin 1 of each header at the other end, turned half a turn
  const a = tangle ? e + span : e
  const rot = (r: number) => `${r + (tangle ? 180 : 0)}deg`

  return (
    <PCB name={name} revision="0.1.0" autoroute={ripup === undefined ? undefined : { ripup }}>
      <rect layer="Edge.Cuts" x={0} y={0} w={W} h={W} />

      <U1 at={`${C} ${C}`} />
      <JL at={`2 ${a} ${rot(0)}`} />
      <JB at={`${a} ${W - 2} ${rot(90)}`} />
      <JR at={`${W - 2} ${a} ${rot(0)}`} />
      <JT at={`${a} 2 ${rot(90)}`} />
      {caps.map((Cn, k) => {
        const [sx, sy] = [
          [-1, -1],
          [-1, 1],
          [1, 1],
          [1, -1],
        ][k]
        return <Cn at={`${C + sx * 6} ${C + sy * 6} ${k % 2 ? 45 : -45}deg`} />
      })}

      {/* every QFN pin to its header pin */}
      {Array.from({ length: 64 }, (_, i) => {
        const n = i + 1,
          side = Math.floor(i / 16)
        return route(U1[n as 1], headers[side][pinOf(n) as 1], stairSides.includes(side) ? stair(n) : undefined)
      })}
      {/* decoupling: each cap to its two pins, and the four VDD pads joined in a ring under the QFN, a loop by design */}
      {caps.map((Cn, k) => route(Cn[1], U1[corners[k][0] as 1]))}
      {caps.map((Cn, k) => route(Cn[2], U1[corners[k][1] as 1]))}
      {caps.map((Cn, k) =>
        route(Cn[1], caps[(k + 1) % 4][1])
          .direct()
          .loop(),
      )}

      {pour(GND, 'B.Cu', rect(W, W))}
      <Brand at="13.85 7.25" height={6} />
    </PCB>
  )
}

/** RIPUP and STAIR from the environment, for router experiments. */
export const env = {
  ripup: process.env.RIPUP ? Number(process.env.RIPUP) : undefined,
  stair: process.env.STAIR?.split(',').map(Number),
}
