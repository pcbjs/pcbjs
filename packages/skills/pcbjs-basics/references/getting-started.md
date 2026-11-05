# Start a pcbjs board

## A new project

```sh
npx -p @pcbjs/pcbjs pcbjs create my-board && cd my-board
npm install
npx pcbjs check
```

`create` writes `pcb.tsx`, `pcb.config.ts` with `entries: ['pcb.tsx']`, `package.json`, `tsconfig.json` with `"jsxImportSource": "@pcbjs/core"`, and a `.gitignore` that leaves out `.pcbjs/`. Every command reads its boards from `entries` in `pcb.config.ts`; entries on the command line win for that run. `pcbjs docs quickstart` has the files.

## A board

```tsx
// Hello: a green LED on a 24 x 15 mm board, powered from a two-pin header.
// Frame: mm, origin at the top-left corner of the outline, x right, y down.
import PCB from '@pcbjs/fab/JLCPCB/2-Layer'
import { nets, route, pour, keepout } from '@pcbjs/core'
import { PinHeader, R0603, LED0603, MountingHole, roundedRect, rect, circle } from '@pcbjs/lib'

const { GND, VCC, LED } = nets()
const J1 = PinHeader(2)().source({ MPN: 'PEC02SAAN' }).connect({ 1: GND, 2: VCC })
const R1 = R0603('330').source({ MPN: 'RC0603FR-07330RL', 'MPN:LCSC': 'C23138' }).connect({ 1: VCC, 2: LED })
const D1 = LED0603('green').source({ MPN: 'LTST-C190GKT' }).connect({ A: LED, K: GND })
const H1 = MountingHole(2.2)()

export default (
  <PCB name="Hello" rev="0.1.0">
    <path layer="Edge.Cuts" d={roundedRect(24, 15, 1)} />
    <J1 at="3 4.96" />
    <R1 at="9 7.5" />
    <D1 at="15 7.5 180deg" />
    <H1 at="20.5 3.5" />
    {route(J1[2], R1[1]).width(0.3).Z()}
    {route(R1[2], D1.A).width(0.3).Z()}
    {route(D1.K, J1[1]).width(0.3)}
    {pour(GND, 'B.Cu', rect(24, 15))}
    {keepout(circle(5, 20.5, 3.5))}
    <text layer="F.SilkS" at="10 12" size={1}>Hello</text>
  </PCB>
)
```

Order in a board file: a header comment with the frame, imports with the fab preset first, nets, parts one per line, then the layout: outline, placements, routes per net, pours, silk last. Move nets and parts to `<board>.sch.ts` once they outgrow a screen and pass it to the board as `import * as sch` with `<PCB schematic={sch}>`, which puts every export in scope by its bare name; part numbers go to `<board>.sourcing.ts`.

## Parts and nets

- `.connect({ … })` takes the nets by pin name and throws at the call on a wrong pin, so a bad connection fails before any layout. `NC` marks a pin open on purpose.
- The constant a part is bound to is its ref, `const R1 = …` is R1; nothing is numbered. A part made in `.map` takes its `ref` from the loop data.
- `U1[7]` is the pad numbered 7, never the seventh pin; `D1.A` is the pin named A.
- Declare `defineFootprint` pins inline or `as const`, or `U1.PA9` fails to type-check.
- Topics `schematic`, `footprints` and `stdlib` have the rest.
