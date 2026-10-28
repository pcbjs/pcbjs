# Boards that meet

When boards plug into each other, a mezzanine, an accessory on a bus, a test jig, check the stack in the compiler: `reference()` brings the other entry's board in as a mechanical reference, checks the mate pad for pad and the nets across it, and checks every body in the gap. `pcbjs docs references` has the API.

## Mates

```tsx
import PCB from '@pcbjs/fab/JLCPCB/2-Layer'
import { nets, reference } from '@pcbjs/core'
import { PinSocket } from '@pcbjs/lib'

const { GND, VCC, SDO, SDI } = nets()
const J3 = PinSocket(4, { value: 'socket' }).connect(GND, VCC, SDO, SDI)
const J4 = PinSocket(4, { value: 'socket' }).connect(GND, VCC, SDO, SDI)

export default (
  <PCB name="Base">
    <rect layer="Edge.Cuts" x={0} y={0} w={60} h={40} />
    <J3 at="10 10" />
    <J4 at="50 10" />
    {reference('../sense/pcb.tsx', {
      mate: [{ local: J3, remote: 'J1', pin: 1, nets: { SDO: 'SDI', SDI: 'SDO' } }, { local: J4, remote: 'J2' }],
      stack: 'above',
      gap: 11.04,
    })}
  </PCB>
)
```

- Mate every connector pair, not just the first: the first pair places the board, every pair is checked by `reference-mate` and `reference-net` and left out of `reference-collision`.
- `nets: true` wants the same names; an object maps local names to remote ones; a list value lets one local net meet several, as a loop-back does; a function folds names such as `GND_*`.
- Lower `gap` until `reference-collision` fires to find the tightest clearance in the stack, then put it back.
- After an edit, `pcbjs inspect references --json` gives where the other board's origin landed; assert it in a contract, since moving the local connector moves the other board with it and the mate alone never catches a misplaced connector.
- Two lands whose pads sit differently about their pins, such as a socket at 1.975 mm and a header at 2.00, leave the other board off by the difference: correct it with `offset`.

## Body heights

The collision check uses each footprint's `height`, else the top of its model file's box, else 1 mm. `pcbjs inspect references` lists every body by source. Set `height` by hand only where the model is nominal or generic and the datasheet maximum matters; write the source in a comment.

## One pinout module

Both sides of a connector take their `.connect()` map from one module, so a board cannot disagree with its mate.

```ts file=pinout.ts
import type { Connection } from '@pcbjs/core'

export type JointPin = 1 | 2 | 3 | 4 | 5 | 6
export type JointNet = 'GND' | 'VCC' | 'SD' | 'CLK'
const ROWS = { outer: ['GND', 'SD', 'GND'], inner: ['VCC', 'CLK', 'VCC'] } as const

/** The connect map of the 2 x 3 joint; `oddRow` is the row the odd pins are on. */
export function joint(oddRow: 'outer' | 'inner', nets: Record<JointNet, Connection>): Record<JointPin, Connection> {
  const even = oddRow === 'outer' ? 'inner' : 'outer'
  const map = {} as Record<JointPin, Connection>
  ROWS[oddRow].forEach((n, i) => { map[(2 * i + 1) as JointPin] = nets[n] })
  ROWS[even].forEach((n, i) => { map[(2 * i + 2) as JointPin] = nets[n] })
  return map
}
```

```tsx file=board.tsx
import PCB from '@pcbjs/fab/JLCPCB/2-Layer'
import { nets, route, NC } from '@pcbjs/core'
import { PinSocket } from '@pcbjs/lib'
import { joint } from './pinout'

const { GND, VCC, SDI, CLK } = nets()
const J1 = PinSocket(3, { rows: 2 }).connect({ ...joint('outer', { GND, VCC, SD: SDI, CLK }), 6: NC })

export default (
  <PCB name="Strip">
    <rect layer="Edge.Cuts" x={0} y={0} w={20} h={10} />
    <J1 at="5 3" />
    {route(J1[1]).X(J1[5])}
  </PCB>
)
```

- Type the pin keys as a literal union so the typed `.connect()` still checks the pins.
- Spread the map and override single pins after it for a board that leaves pins open.

## One frame module

Shared geometry, the outline, mounting holes and their keep-outs, an antenna end, a module's position, lives in one module of plain constants that both entries import. `reference()` compiles the other entry in its own process, so share constants, never parts. Derive each keep-out from the hole or module it protects in the same `.map()`, and throw when a derived keep-out stops covering what it must: a `cond && keepout(…)` drops the keep-out silently when the condition fails.
