# Board patterns

Complete examples that compile as they stand. Copy the pattern, not the coordinates: take positions from `pcbjs inspect`.

## Schematic in its own module

Nets and parts move to `pcb.sch.ts` once they outgrow a screen; the board file imports the module as a namespace, passes it to `<PCB schematic={sch}>`, and only places and routes. Every export of the module is then in scope by its bare name in that file, with no import list. A part keeps the ref of its exported const.

```ts file=pcb.sch.ts
import { nets, bus, NC } from '@pcbjs/core'
import { PinHeader, R0603, C0603, SOIC } from '@pcbjs/lib'

export const { GND, VCC, OUT } = nets({ VCC: { class: 'power' }, GND: { class: 'power' } })
export const D = bus('D', 2)

export const J1 = PinHeader(4)().connect({ 1: GND, 2: VCC, 3: D[0], 4: D[1] })
export const U1 = SOIC(8)('74LVC2G04').connect({ 1: D[0], 2: GND, 3: OUT, 4: GND, 5: NC, 6: D[1], 7: NC, 8: VCC })
export const R1 = R0603('10k').connect({ 1: OUT, 2: GND })
export const C1 = C0603('100n').connect({ 1: VCC, 2: GND })
```

```tsx file=pcb.tsx
import PCB from '@pcbjs/fab/JLCPCB/2-Layer'
import { route, pour, stitch } from '@pcbjs/core'
import { rect, Brand } from '@pcbjs/lib'
import * as sch from './pcb.sch'

export default (
  <PCB name="Split" rev="0.1.0" schematic={sch} classes={{ power: { width: 0.4 } }}>
    <rect layer="Edge.Cuts" x={0} y={0} w={30} h={20} />
    <J1 at="3 6.19" />
    <U1 at="16 10" />
    <R1 at="24 6" />
    <C1 at="16 4.5" />
    {route(J1[3], U1[1])}
    {route(J1[4], U1[6])}
    {route(U1[3], R1[1])}
    {route(J1[2], C1[1])}
    {route(C1[1], U1[8])}
    {pour(GND, 'F.Cu', rect(30, 20))}
    {pour(GND, 'B.Cu', rect(30, 20))}
    {stitch(GND, { pitch: 5, padClearance: 0.5 })}
    <Brand at="15 16" height={5} layer="B.SilkS" />
  </PCB>
)
```

`VCC` and `GND` take the class `power`, so their routes are 0.4 mm without a `.width()`. `stitch()` adds GND vias wherever both pours have fill; `pcbjs inspect GND` counts them. `<Brand>` signs the board with the pcbjs logo in a free silk corner, 4 to 6 mm high, here on the back because the front is full; `pcbjs docs stdlib` has its props.

## A channel row with named blocks

Parts made in a `.map` take their `ref` from the loop data; a `<g name>` around each block makes findings and `inspect` say `R3 (CH3/R3)`.

```tsx
import PCB from '@pcbjs/fab/JLCPCB/2-Layer'
import { nets, route } from '@pcbjs/core'
import { PinHeader, R0603, LED0603 } from '@pcbjs/lib'

const { VCC, GND } = nets()
const J1 = PinHeader(2)().connect({ 1: GND, 2: VCC })
const CH = [1, 2, 3, 4].map(i => {
  const { A } = nets(`CH${i}`)
  return { i, x: 4 + i * 6, R: R0603('330', { ref: `R${i}` }).connect({ 1: VCC, 2: A }), D: LED0603('red', { ref: `D${i}` }).connect({ A, K: GND }) }
})

export default (
  <PCB name="Row" rev="0.1.0">
    <rect layer="Edge.Cuts" x={0} y={0} w={36} h={14} />
    <J1 at="3 5.73" />
    {CH.map(({ i, x, R, D }) => (
      <g name={`CH${i}`}>
        <R at={`${x} 4`} />
        <D at={`${x} 9`} />
        {route(R[2], D.A)}
        {route(R[1], J1[2])}
        {route(D.K, J1[1])}
      </g>
    ))}
  </PCB>
)
```

A block with its own ports and private nets is a `circuit()`, see `pcbjs docs circuits`.

## Length matching and a pair

```tsx
import PCB from '@pcbjs/fab/JLCPCB/4-Layer'
import { nets, route } from '@pcbjs/core'
import { PinHeader } from '@pcbjs/lib'

const { CLK, D0, D1, GND } = nets()
const J1 = PinHeader(4)().connect({ 1: CLK, 2: D0, 3: D1, 4: GND })
const J2 = PinHeader(4)().connect({ 1: CLK, 2: D0, 3: D1, 4: GND })

export default (
  <PCB name="Matched" rev="0.1.0">
    <rect layer="Edge.Cuts" x={0} y={0} w={40} h={20} />
    <J1 at="5 5" />
    <J2 at="35 5" />
    {route(J1[1], J2[1]).width(0.2).length(32).Z()}
    {route(J1[2], J2[2]).width(0.2).match('DATA').Z()}
    {route(J1[3], J2[3]).width(0.2).match('DATA').H(20).V(16).H(32).V(10.08).Z()}
    {route(J1[4], J2[4]).width(0.3).layers(['In1.Cu', 'B.Cu'])}
  </PCB>
)
```

`pcbjs inspect --lengths` prints each route with its length, target, group, skew, what tuning added and its status. A differential pair is `route([P, N])` with array ends, see `pcbjs docs pairs`.

## A config for several boards

```ts file=pcb.config.ts
import { defineConfig, defineDefaultBoard } from '@pcbjs/core'
import { JLCPCB } from '@pcbjs/lib/rules'

defineDefaultBoard({ rules: JLCPCB })

export default defineConfig({
  entries: ['boards/*.tsx'],
  kicad: { footprints: ['lib/footprints'] },
})
```

`defineDefaultBoard` is process-wide, so call it only in the config or a module every entry imports. A board's own `rules` merge over its rules key by key.
