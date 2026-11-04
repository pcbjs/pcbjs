# Circuits

Parts are values: arrays, plain functions and `.map` build repeated blocks, a named `<g>` names them, and `circuit()` adds enforced ports, private nets and indexed instances.
Advanced. A circuit part's ref is its local name with the instance index, `R201` for `CH2/R01`; the hierarchy travels as paths in the netlist, the findings, inspect and the viewer.

## Plain functions and arrays

```tsx
// pcb.tsx
import { nets, route } from '@pcbjs/core'
import { R0603, LED0603 } from '@pcbjs/lib'

const { VCC, GND } = nets()
const LEDS = [1, 2, 3, 4].map(i => {
  const { A } = nets(`L${i}`)
  return { x: i * 8 - 3, R: R0603('330', { ref: `R${i}` }).connect({ 1: VCC, 2: A }), D: LED0603('green', { ref: `D${i}` }).connect({ A, K: GND }) }
})
const row = ({ x, R, D }: (typeof LEDS)[number], i: number) => (
  <g name={`P${i + 1}`}>
    <R at={`${x} 5`} />
    <D at={`${x} 9`} />
    {route(R[2], D.A).width(0.25)}
  </g>
)
// in the board: {LEDS.map(row)}
```

- Parts made in a loop take their `ref` from the loop data; nothing is numbered for them.
- `<g name="P3">` names a block: findings print `R3 (P3/R3)`, `pcbjs inspect pcb.tsx P3/R3` finds it, the viewer and editor show it. Names are identifiers; two `<g>` of one path are a compile error.
- `<Place part={LEDS[2].R} at="…" />` places a part the file cannot write as an element.
- A route made in a helper points at its call site, `pcb.tsx:<line> via pcb.tsx:<line>`, in findings and `inspect --lengths`.

## Circuits with ports

```tsx file=led-channel.tsx
// led-channel.tsx
import { circuit, route, type Ports } from '@pcbjs/core'
import { R0603, LED0603 } from '@pcbjs/lib'

export const schematic = circuit('ledChannel', ({ VCC, SW }: Ports<'VCC' | 'SW'>, { nets: { led } }) => {
  const R01 = R0603('330').connect({ 1: VCC, 2: led })
  const D01 = LED0603('green').connect({ A: led, K: SW })
  return { R01, D01 }
})
```

```ts file=board.sch.ts
// board.sch.ts
import { nets } from '@pcbjs/core'
import { schematic as ledChannel } from './led-channel'

export const { VCC, SW1 } = nets()
export const CH1 = ledChannel({ VCC, SW: SW1 }, 'CH1')
```

- `circuit(name, build)`: `build` takes the ports, typed by `Ports<'VCC' | 'SW'>`, and `{ nets, local }`, one proxy of private nets, and returns every part and nested instance under its name.
- A part's local name is its binding inside the build or its key; a part bound as `R01` and returned under another key is a `SchematicError`, one name per part.
- An instance has typed members, `CH1.R01` a part and `CH1.R01[2]` a pin, plus `name`, `circuit`, `path` such as `['Power1', 'LDO1']`, `ports` and `nets`: `CH1.nets.led` is `CH1/led`.
- A build may bind and return a route, `const vccTrunk = route(…)`; each instance has it as `CH1.vccTrunk`, its layout places it, `{g.vccTrunk}`, and its points such as `CH1.vccTrunk.end` are route ends elsewhere, routing.md Route points.

### Ports

- Parts connect only to ports and private nets, else a `SchematicError` at `connect`.
- Every port must be passed, else it throws when read; one ending in `?`, `Ports<'VIN' | 'EN?'>`, also takes `NC`.

### Instance indices

Every instance takes an index after its ports: a whole number, `ledChannel(ports, 2)` named `ledChannel2`, or a name ending in digits, `ledChannel(ports, 'CH2')`. An instance without one is a `SchematicError`; nothing is counted. Nested instances take theirs in the build, `{ LDO1: ldo(ports, 1) }`; paths concatenate, and two instances on one path are a compile error.

## Refs

A circuit part's ref is the letters of its local name, the digits of every instance index from the outermost, then the digits of its local name: `CH2/R01` is `R201`, `R` in `CH1` is `R1`, `C1` in `Power1/LDO2` is `C121`. The handle `ch2.R01`, the reference `CH2/R01` and the ref `R201` are one part. Netlist parts carry `path` and `local`; findings print `R201 (CH2/R01)`, `pcbjs inspect pcb.tsx CH2/R01` finds it, and `<PCB refStyle="hierarchical">` names it `CH2_R01`. Two parts on one ref are a compile error.

## Layouts

For a small reusable group, keep its electrical definition and physical layouts in one `.tsx` module. Export `schematic`, `layout`, and descriptive alternatives such as `layoutStack`. Use `schematic.layout(render, name?)` without importing a separate layout factory. In a board, import the component with an uppercase alias, `import { layout as LedChannelRow } from './led-channel'`, for JSX. The board schematic and board layout can still be separate files.

```tsx {11-19,24-26} preview=reference-circuit-layout
import PCB, { circuit, nets, route, type Ports } from '@pcbjs/core'
import { R0603, LED0603, rect } from '@pcbjs/lib'

export const schematic = circuit('ledChannel', ({ VCC, SW }: Ports<'VCC' | 'SW'>, { nets: { led } }) => {
  const R01 = R0603('330').connect({ 1: VCC, 2: led })
  const D01 = LED0603('green').connect({ A: led, K: SW })
  return { R01, D01 }
})

export const layout = schematic.layout((g, { at, side, label }) => (
  <g at={at} side={side}>
    <g.R01 at="-4 0" />
    <g.D01 at="4 0 180deg" />
    {route(g.R01[2], g.D01.A).width(0.3).Z()}
    {label && <text layer="F.SilkS" at="0 -1.4" size={0.8}>{label}</text>}
  </g>
), 'LedChannelRow')
const LedChannelRow = layout
const { VCC, SW1 } = nets()
const CH1 = schematic({ VCC, SW: SW1 }, 'CH1')

export default (
  <PCB name="ChannelLayout">
    <path layer="Edge.Cuts" d={rect(30, 16)} />
    <LedChannelRow g={CH1} at="16 5" label="LED1" />
  </PCB>
)
```

- `<LedChannelRow g={CH1} at="16 5" label="LED1" />` or `{LedChannelRow({ g: CH1, at: '16 5' })}`; `<CH1.R01 at="12 5" />` places one part without a layout.
- Keep the local grid origin near the group's visual centre. Here the parts straddle `(0, 0)`; the placement's `at` carries the board offset. Routes, vias and text inside the layout use the same local frame. This makes rotation about the group's own origin intuitive.
- A child of the layout element places one part of that instance in place of the layout's placement and in the same frame, `<LedChannelRow g={CH1} at="16 5"><CH1.R01 at="-3 0" /></LedChannelRow>`; the other instances keep the layout's. A child that is no part of the instance, or replaces no placement of the layout, is a compile error. The editing tools write it, editing.md.
- Give variants distinct explicit runtime names, such as `LedChannelRow` and `LedChannelStack`. These names identify definitions within the module and may differ from exported variable names. Source focus follows the individual declaration, not the whole file. Split large blocks into modules when it improves readability; separate files are not required for source mapping.
- `schematic.layout(render, name?)` is equivalent to `layout(schematic, render, name?)`. Both take the instance as `g` plus any props; route with `g.nets.led`, `g.ports.VCC` or `g.R01[2]`. A circuit may have several; the viewer shows the name.
- `instance.layout(render, name?)` creates a component restricted to that exact instance; pass it as `g` when placing the component. The callback retains the instance's member and port types. `layout` is reserved as a circuit member name.
- Names default to the render function's name, then `<circuitName>Layout` for an anonymous callback. Give multiple variants explicit names to keep their identities distinct.
- Isolation controls visibility. **Instance layout** writes overrides for one placement; **Library layout** shows the reusable local definition and writes shared source, affecting its instances. Required parameters may use the focused instance's values; auto-numbering remains independent. See editing.md.
- The `<g>` of the render that takes the element's `at` is the instance's frame, so the viewer's tools move, turn and flip the instance by writing the element's `at` and `side`, which the render passes on, `<g at={at} side={side}>`, editing.md.
- Laid out twice, or a part placed outside its layout: a compile error. An instance or part declared but never placed: a compile error naming it.

## Sourcing

`.source({ … })` on a part, inside the build or out of line on an instance's member, `CH1.R01.source({ MPN: 'RC0603FR-07330RL' })`. See sourcing.md.
