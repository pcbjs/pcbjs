# Circuits

Parts are values: arrays, plain functions and `.map` build repeated blocks, `group()` names them, and `circuit()` adds enforced ports and private nets.
Refs stay flat; the hierarchy travels as instance paths in the netlist, the findings, inspect and the viewer.

## Plain functions and arrays

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

- Parts are numbered by declaration order, R1 to R4; a finding says `R3`, not which LED, until `group()` names it.
- A route made in a helper points at its call site, `pcb.tsx:<line> via pcb.tsx:<line>`, in findings and `inspect --lengths`.

## Names with group()

```tsx
import { group } from '@pcbjs/core'

const PORTS = [0, 1, 2, 3].map(i => {
  const { A } = nets(`L${i}`)
  return group(`P${i + 1}`, { x: 5 + i * 8, R: R0603('330').connect(VCC, A), D: LED0603('green').connect({ A, K: GND }) })
})
```

- `group(name, object)` names each part by its key: `PORTS[2].R` is `P3/R`, findings print `R3 (P3/R)`, `pcbjs inspect pcb.tsx P3/R` finds it, the viewer and editor show it.
- Returns the same object and type, plus non-enumerable `name`, `circuit` set to `'group'`, and `path`; fields such as `x` pass through.
- An array field names parts by index, `P1/LEDS[0]`; a nested group or instance keeps its name, `Bank/Sense/R`.
- A name twice in one file, a part in two groups, or a field named `name`, `circuit`, `path` or `$$` is a `SchematicError`; names are identifiers.
- No ports, no private nets, refs unchanged. `layout(group, render)` places it like an instance.

## Circuits with ports

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

- `circuit(name, build)`: `build` takes the ports, typed by `Ports<'VCC' | 'SW'>`, and `{ nets, local }`, one proxy of private nets, and returns every part and nested instance under a key.
- An instance has typed members, `CH1.R` a part and `CH1.R[2]` a pin, plus `name`, `circuit`, `path` such as `['Power', 'LDO']`, `ports` and `nets`: `CH1.nets.led` is `CH1/led`.
- `circuit('root', { J1: PinHeader(3).connect(…), R1: R0603('1k').connect(…) })` makes one portless instance of existing parts.

### Ports

- Parts connect only to ports and private nets, else a `SchematicError` at `connect`.
- Every port must be passed, else it throws when read; one ending in `?`, `Ports<'VIN' | 'EN?'>`, also takes `NC`.

### Instance names

The second argument, `buck(ports, 'Buck1')` or `buck.named('Buck1')(ports)`; else inside a circuit its key, `{ LDO: ldo({ … }) }` is `Power/LDO`; else the circuit name and lowest free counter, `buck1`, `buck2`. Paths concatenate; two instances on one path are a compile error.

## Refs

An instance numbers at its declaration, its parts in key order, so `CH2.R` may be R4. Netlist parts carry `path` and `local`, the key; findings print `R4 (CH2/R)`, `pcbjs inspect pcb.tsx CH2/R` or `CH2.R` finds it, and `<PCB refStyle="hierarchical">` names it `CH2_R`.

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

- `<LedChannelRow g={CH1} at="0 5" label="LED1" />` or `{LedChannelRow({ g: CH1, at: '0 5' })}`; `<CH1.R at="12 5" />` places one part without a layout.
- `layout(circuit, render, name?)`: takes the instance as `g` plus any props; route with `g.nets.led`, `g.ports.VCC` or `g.R[2]`. A circuit may have several; the viewer shows the name.
- Laid out twice, or a part placed outside its layout: a compile error. Nothing placed: ERC error `unplaced-circuit`; partly placed: `unplaced-part` per missing part.

## Sourcing

`source(CH1.R, spec)` sets one part, `source(CH1, spec)` every part, nested instances too; factory rules such as `source(R0603, '330', spec)` reach circuit parts. See sourcing.md.
