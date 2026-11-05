# Schematic in its own module

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
