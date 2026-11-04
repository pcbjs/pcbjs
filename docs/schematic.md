# Schematic

Nets and parts as values in a schematic module whose exports a board uses by name: `nets()`, footprint factories, part names, `.connect`, pin and pad handles, `NC`.
Basic. Your own footprints with `defineFootprint` and its typing rules are in footprints.md; circuits with ports in circuits.md; sourcing in sourcing.md; ERC rule names in findings.md.

```ts file=board.sch.ts
import { nets } from '@pcbjs/core'
import { R0603 } from '@pcbjs/lib'
export const { VCC, GND } = nets()
export const R1 = R0603('330').connect({ 1: VCC, 2: GND })
```

```tsx
import PCB from '@pcbjs/core'
import * as sch from './board.sch'
export default <PCB name="Blink" rev="0.1.0" schematic={sch}>
  <R1 at="10 20" />
</PCB>
```

## The schematic module

- Every export of `<PCB schematic>`'s module, `export *` chains included, is in scope by name in the whole file; the file's own declarations and imports, and globals such as `Math`, win. `sch.R1` and `import { R1 }` are the same part.
- One schematic namespace per file. `pcbjs check`, `dev` and `build` know the scope; plain `tsc` reports `Cannot find name 'R1'`.
- The module's `drawing` export is the schematic picture, see schematic-graphic.md.

## Nets

```ts
import { nets, local, bus, NC } from '@pcbjs/core'

export const { GND, VCC, SIG } = nets()           // one Net per key read
export const D = bus('D', 8)                      // D0 to D7
export const P1 = nets('P1')                      // P1.CC1 is the net P1/CC1
```

| Call | Gives |
| --- | --- |
| `nets()` | a proxy; each key read gives that `Net`, the same object every time |
| `nets('P1', { VBUS: { class: 'power' } })` | nets `P1/<key>`, classes by short name; global, so `local('P1')` or an instance `P1` with a private `CC1` is the same net |
| `bus(name, n)` | nets `name0` to `name<n-1>` |
| `local()` | in a component, private to the instance, `Divider#2/mid`; outside, to the label, `local('Chan')` |
| `net.rules({ clearance })` | `GND.rules({ clearance: 0.3 })`: anonymous class `net:<name>` over its own; returns the net; rules.md Overrides |
| `NC` | a pin open on purpose; no net and no `NC` is the ERC warning `unconnected-pin` |

Every net prop and helper takes a `Net`; a string is a compile error. Two nets of one name on one board are one net.

## Parts

```ts
const R1 = R0603('330').connect({ 1: VCC, 2: LED })               // by pin number
const D1 = LED0603('green').connect({ A: LED, K: GND })         // or by pin name
const J1 = PinHeader(3)().connect({ 1: GND, 2: VCC, 3: SIG })
const R2 = R0603('10k').source({ MPN: 'RC0603FR-0710KL' }).connect({ 1: VCC, 2: SIG })
```

A part is made once, by its factory call, and placed once, by its element. The factory takes the value as a string, then the part options:

| Option | Does |
| --- | --- |
| `ref` | the ref of a part no binding names, such as one made in a loop |
| `bom`, `pos` | false keeps it out of the BOM or the placement file |
| `dnp` | not populated: out of the BOM and the placement file, still on the board and in the DRC |
| `height`, `model` | the 3D body, 3d.md |

| Method | Does |
| --- | --- |
| `.connect({ … })` | a `Net` or `NC` per pin, by pin name; an unknown pin, a pin twice or a string throws a `SchematicError` |
| `.source({ … })` | part numbers and BOM fields, sourcing.md |
| `.rules({ clearance, edgeClearance, holeClearance, trackWidth, thermal })` | overrides for every pad, `thermal: { angle }` among them, rules.md |
| `.value`, `.prefix`, `.pins` | read the part |

- A placement takes `at`, `side`, `ref:at` and `thermal`, children too; anything else is a compile error naming the part. `ref:at={false}` drops the silk ref, layout.md Silk refs.
- Placed twice: a compile error. A part of a file that placed parts, never placed itself: a compile error naming it.
- A part never connected is copper on no net, such as a mounting hole's ring, and raises no `unconnected-pin`; once connected, every pin it leaves out does.
- A part with no pins, a bare hole or a fiducial, is a part too: `const H1 = MountingHole(3.2)()`.

## Names

A part's name is its ref, on the silk, in the BOM, in findings and in `inspect`: the `const` or `let` it is bound to, in any file and in any declaration order.

- `const R2 = R1` is an alias; the first name wins. Destructuring names each binding, `const { R, D } = row`.
- Names read capital letters then digits, `R1` or `LED3`; another name such as `J_HR` is allowed, and the language server marks it with a hint.
- A part made in a loop or by code has no binding of its own: give it `{ ref }` from the loop data, `LED0603('red', { ref: `D${i + 1}` })`, and place it with `<Place part={LEDS[i]} at="…" />`.
- A placed part with no name is a compile error that suggests the next free one; the editor's quick action `Name this part R4` extracts it to a constant.
- Two parts of one name on a board: a compile error naming both.
- Inside a circuit the name is local, `CH2/R01`, and the ref takes the instance index, `R201`, circuits.md.
- The board data lists each instance and named `<g>` in `schematic.circuits` with its `path`, `kind`, `circuit` or `group`, `def`, its definition as `lib/led-channel.tsx#ledChannel` or a `<g>` as `pcb.tsx#12:5`, `layout`, the layout that placed it as `lib/led-channel.tsx#LedChannelRow`, and `parent`, the enclosing instance's path. Two circuits named alike in two files are two definitions, and a `<g>` a loop renders four times one; the viewer's isolation and the editing tools count instances by `def`, editing.md.

## Placing

```tsx
const LEDS = [1, 2, 3].map(i => LED0603('red', { ref: `D${i}` }).connect({ A: VCC, K: GND }))
const layout = [
  <R1 at="10 5" />,
  <CH2.R01 at="20 5" />,
  LEDS.map((d, i) => <Place part={d} at={`${5 + i * 4} 10`} />),
  <g name="Power" at="30 10">
    <U1 at="0 0" />
    <C1 at="4 0" />
  </g>,
]
```

- A part in scope is its own element; `<Place part={…}>` places one the file cannot name, the same on the board and inside `<Schematic>`.
- A `<g name>` is one level of hierarchy: findings, `inspect` and the viewer name its parts `Power/U1`; a function returning `<g name>` repeats a block.

## Pin and pad handles

| Handle | Meaning |
| --- | --- |
| `D1.A` | the pin named A |
| `U1[7]`, `U1['7']` | pad number 7, whatever pin sits there; on an LED `D1[1]` is K |
| `J1['B4']`, `J1.B4` | the pad numbered or named B4 |

```ts
const J1 = USBC('full16')('TYPE-C-31-M-12').connect({ GND, VBUS, DP, DN, CC1, CC2, SHIELD: GND, SBU1: NC, SBU2: NC })
route([J1.B6, J1.A7], [U1.DP, U1.DM]).impedance(90).Z()  // a pair from one pad each
route(J1['A4'], '9 19.05')                               // one of the two VBUS pads
```

- A number is a pad number, never a list position; another key is a pin name, then a pad name: `J1.VBUS` is the pin on A4 and B4. A pad number that is its pin's name, `J1[3]` on a header, gives the pin.
- An unknown key throws a `SchematicError` naming the part, the nearest pin or pad and both lists. A pad handle naming no pad, or a number several pads share, is a compile error.
- A pin with several pads ends a route at the pad nearest the other end; a pad handle chooses.
- `.net` is the pin's net, also on a pad handle: `J1.DP.net` and `J1.B6.net` are `DP`; `NC` for an NC pin or pad; a `SchematicError` before `.connect()` or for a pin left out. `via(J1.B6, at)` takes that net.

## How pads get nets

A pad belongs to the pin named like its name, else its number, never by position; one matching no pin is a compile error naming footprint, pad and pins. Pads take their nets from the part's `.connect()` only.

- `<pad num={4} nc … />` or the footprint's `nc` list: no net, no pin, no ERC finding; touching a net is a DRC `short`.
- Non-plated holes and unnumbered pads take no net.

## Library preview

Library mode isolates the reusable template in schematic, 2D and 3D previews. It shows only the selected template's parts and connections, including parts without a PCB placement, with references starting at zero and private-net labels local to the template. Its schematic is laid out independently of board instantiations. A caret inside an instantiated circuit or layout declaration enters this mode; moving to a board instance leaves it. Selection stays synchronized, and leaving restores the previous schematic camera. See layout-editing.md for source ownership and parameter defaults.
