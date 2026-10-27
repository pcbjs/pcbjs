# Circuits

Parts are values: arrays, plain functions and `.map` build repeated blocks, `group()` names them, and `circuit()` adds enforced ports and private nets.
Refs stay flat; the hierarchy travels as instance paths in the netlist, the findings, inspect and the viewer.

## Plain functions and arrays

A part is an ordinary value, so the natural TypeScript works: make parts in a function, keep them in objects and arrays, place and route them in a `.map`.

```tsx
// pcb.tsx
import { nets, route } from '@pcbjs/core'
import { R0603, LED0603 } from '@pcbjs/lib'

const { VCC, GND } = nets()
const LEDS = [0, 1, 2, 3].map(i => {
  const { A } = nets(`L${i}`)
  return { x: 5 + i * 8, R: R0603('330').connect(VCC, A), D: LED0603('green').connect({ A, K: GND }) }
})
const row = ({ x, R, D }: (typeof LEDS)[number]) => [
  <R at={`${x} 5`} />,
  <D at={`${x} 9`} />,
  route(R[2]).X(D.A).width(0.25),
]
// in the board: {LEDS.map(row)}
```

- Each part is numbered like any other, by declaration order: the four resistors are R1 to R4.
- A route made in a helper or in a `.map` callback inside one is attributed to the helper's call site, `pcb.tsx:<line> via pcb.tsx:<line>`, in findings and in `inspect --lengths`. A route written inline in the board's JSX names its own line.
- Nothing names the block: a finding says `R3`, not which LED it belongs to. `group()` adds that.

## Names with group()

```tsx
import { group } from '@pcbjs/core'

const PORTS = [0, 1, 2, 3].map(i => {
  const { A } = nets(`L${i}`)
  return group(`P${i + 1}`, { x: 5 + i * 8, R: R0603('330').connect(VCC, A), D: LED0603('green').connect({ A, K: GND }) })
})
```

- `group(name, object)` makes the object one named instance. Every part in it becomes a member under its key, so `PORTS[2].R` is `P3/R`: findings print `R3 (P3/R)`, `pcbjs inspect pcb.tsx P3/R` finds it, and the viewer and the editor show the path.
- It returns the same object, typed as it was, with `name`, `circuit`, which is `'group'`, and `path` added and not enumerable. Fields that are not parts, such as `x`, pass through untouched.
- An array field names its parts by index, `P1/LEDS[0]`. A group or circuit instance in a field nests, `Bank/Sense/R`, keeping its own name.
- Names are identifiers. The same name twice in one file, a part in two groups, or a field named `name`, `circuit`, `path` or `$$` is a `SchematicError`.
- A group has no ports and no private nets: its parts connect to any net. Refs stay flat and numbered as without it.
- `layout(group, render)` places a group like a circuit instance, see Layouts.

## Circuits with ports

`circuit()` is for a block that should be reusable on its own terms: the caller passes nets for named ports, the parts may reach only those and the instance's private nets, and the editor checks the call.

### Defining and calling a circuit

```ts file=led-channel.sch.ts
// led-channel.sch.ts
import { circuit, type Ports } from '@pcbjs/core'
import { R0603, LED0603 } from '@pcbjs/lib'

export const ledChannel = circuit('ledChannel', ({ VCC, SW }: Ports<'VCC' | 'SW'>, { nets: { led } }) => ({
  R: R0603('330').connect(VCC, led),
  D: LED0603('green').connect({ A: led, K: SW }),
}))
```

```ts file=board.sch.ts
// board.sch.ts
import { nets } from '@pcbjs/core'
import { ledChannel } from './led-channel.sch'

export const { VCC, SW1 } = nets()
export const CH1 = ledChannel({ VCC, SW: SW1 }, 'CH1')
```

- `circuit(name, build)` returns a circuit. `build` takes the ports and the instance's own nets and returns the parts by key.
- The type `Ports<'VCC' | 'SW'>` names the ports, so the call is checked in the editor.
- The second parameter has `nets`, a proxy of nets private to the instance, and `local`, the same proxy.
- Every part and nested instance made in the build must come back under a key.
- An instance has its members as typed properties: `CH1.R` is a part and `CH1.R[2]` a pin handle. It also has `name`, `circuit`, `path` such as `['Power', 'LDO']`, `ports` and `nets`: `CH1.nets.led` is the net `CH1/led`.
- The object form, `circuit('root', { J1: PinHeader(3).connect(…), R1: R0603('1k').connect(…) })`, makes one instance of parts made beforehand. It has no ports. `group()` is the same without the restriction to parts.

### Instance names

A variable name cannot be read at run time. An instance takes its name from:

- the second call argument, `buck(ports, 'Buck1')`, or `buck.named('Buck1')(ports)`;
- inside another circuit, its key there: `{ LDO: ldo({ … }) }` is the instance `Power/LDO`;
- otherwise the circuit name and the lowest free counter, `buck1`, `buck2`.

Names are identifiers. Two instances on one board with the same path are a compile error. Circuits nest and their paths concatenate.

### Ports

A port is the only way a net crosses the circuit boundary.

- A part in the build may connect only to the ports and the instance's private nets. Reaching any other net throws a `SchematicError` at `connect`.
- Every port must be passed. A port left out throws when the build reads it.
- A port name ending in `?`, as in `Ports<'VIN' | 'EN?'>`, may take `NC` as well as a net.

## Refs

Every part of every instance is numbered per prefix like any other part, in declaration order: an instance takes its place in that order, then its parts go in key order. So `CH2.R` may be R4 on the board. Each part in the netlist carries `path`, its instance path, and `local`, its key. Findings print both, as `R4 (CH2/R)`, and `pcbjs inspect pcb.tsx CH2/R` or `CH2.R` finds it.

`<PCB refStyle="hierarchical">` names instance parts after their path instead, `CH2_R`. Parts outside circuits keep the flat numbering.

## Layouts

```tsx
// led-channel.layout.tsx
import { layout, route } from '@pcbjs/core'
import { ledChannel } from './led-channel.sch'

export const LedChannelRow = layout(ledChannel, (g, { at, label }) => (
  <g at={at}>
    <g.R at="12 0" />
    <g.D at="20 0 180deg" />
    {route(g.R[2]).Z(g.D.A).width(0.3)}
    {label && <text layer="F.SilkS" at="16 -1.4" size={0.8}>{label}</text>}
  </g>
), 'LedChannelRow')
```

The board places it with `<LedChannelRow g={CH1} at="0 5" label="LED1" />`.

- `layout(circuit, render, name?)` returns a component that takes the instance as `g` plus any props.
- The render function places members as `<g.R … />` and routes with `g.nets.led`, `g.ports.VCC` or `g.R[2]`.
- A circuit may have several layouts, in any file. Pass the name as the third argument; it is what the viewer shows.
- A layout is a plain function too: `{LedChannelRow({ g: CH1, at: '0 5' })}`.

Placement rules:

- An instance laid out twice on one board is a compile error naming both sites.
- A part of an instance placed outside the layout that lays it out is a compile error.
- An instance may skip layouts: `<CH1.R at="12 5" />` places one part.
- An instance on the board with no layout and no part placed is the ERC error `unplaced-circuit`. A partly placed instance gets `unplaced-part` for each missing part.

## Sourcing

`source(CH1.R, spec)` sets keys on one part of an instance and `source(CH1, spec)` on every part in it, nested instances included. Factory rules such as `source(R0603, '330', spec)` reach parts in circuits like any other. See sourcing.md.
