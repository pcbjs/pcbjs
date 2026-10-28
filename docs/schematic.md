# Schematic

Nets and parts as values in a schematic module whose exports a board uses by name: `nets()`, footprint factories, `.connect`, pin and pad handles, `NC`, `defineFootprint` and its typing rules.
Circuits with ports are in circuits.md; ERC rule names are in findings.md.

```ts file=board.sch.ts
import { nets } from '@pcbjs/core'
import { R0603 } from '@pcbjs/lib'
export const { VCC, GND } = nets()
export const R1 = R0603('330').connect(VCC, GND)
```

```tsx
import PCB from '@pcbjs/core'
import * as sch from './board.sch'
export default <PCB name="Blink" schematic={sch}>
  <R1 at="10 20" />
</PCB>
```

## The schematic module

- Every export of `<PCB schematic>`'s module, `export *` chains included, is in scope by name in the whole file; the file's own declarations and imports, and globals such as `Math`, win. `sch.R1` and `import { R1 }` are the same part.
- One schematic namespace per file. `pcbjs check`, `dev` and `build` know the scope; plain `tsc` reports `Cannot find name 'R1'`.
- An export not named like its ref, `export const Rpull = …` numbered R3, reads `R3 (Rpull)` in findings and `pcbjs inspect Rpull` finds it.
- The module's drawing export is the schematic picture, see schematic-graphic.md.

## Nets

```ts
import { nets, local, bus, NC } from '@pcbjs/core'

export const { GND, VCC, SIG } = nets()           // one Net per key read
export const { VIN } = nets({ VIN: { class: 'power' } })
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

Two nets of one name on one board are one net.

## Parts

```ts
const R1 = R0603('330').connect(VCC, LED)                       // nets in pin order
const D1 = LED0603('green').connect({ A: LED, K: GND })         // or by pin name
const J1 = PinHeader(3).connect({ 1: GND, 2: VCC, 3: SIG })     // or by pin number
const R2 = R0603('10k', { MPN: 'RC0603FR-0710KL' }).connect(VCC, SIG)
const R3 = R0603({ value: '1k', fields: { tolerance: '1%' } }).ref('R9').connect(SIG, GND)
```

| API | Does |
| --- | --- |
| options | `value`, `fields`, `source`, `bom`, `pos`, `description`, `height`, `model`; a second argument after a value is a sourcing spec |
| `.connect(...)` | a `Net` or `NC` per pin in order, or an object by pin name or pad number; a wrong count, unknown pin, pin twice or string throws a `SchematicError` |
| `.ref('Q9')` | an explicit ref |
| `.source({...})` | adds sourcing keys |
| `.rules({ clearance, edgeClearance, holeClearance, trackWidth })` | overrides for every pad |
| `.value`, `.prefix`, `.pins` | read the part |

- Placement props: `at`, `side`, `fields`, `bom`, `pos`, `description`, `height`, `model`, `rules` over `.rules()`, children; `ref={false}` and `refAt` drop or place the silk ref, layout.md Silk refs. Any other `ref`, `nets` or `net:*` is a compile error.
- Placed twice: a compile error. A module-level part left unplaced in a file that placed parts: ERC error `unplaced-part`.

## Refs

A module-level `const` or `let` named like a ref, capitals then digits such as `R1` or `LED3`, gives its part that ref in any declaration order; the source transform records it in the project's `.ts` and `.tsx` files.

- `.ref()` wins: `const R3 = R0603('1k').ref('R9')` is R9.
- Two parts on one ref name: a `SchematicError` naming both. `const R2 = R1` is an alias; the first name wins.
- Other names, destructuring, `var`, and parts made in a function or circuit are numbered per prefix in declaration order, the lowest number no name, `.ref()` or written footprint took.
- Inside a circuit or `group()`, findings and `pcbjs inspect` add the path, `R4 (CH2/R)`.

## Pin and pad handles

| Handle | Meaning |
| --- | --- |
| `D1.A`, `D1.pin('A')` | the pin named A |
| `U1[7]`, `U1['7']` | pad number 7, whatever pin sits there; on an LED `D1[1]` is K |
| `J1['B4']`, `J1.B4` | pad handle, numbered or named B4 |
| `J1.pad('B4')` | the same, when B4 is also a pin name |
| `"J1.3"` | route end string: pad by number, then name |

```ts
const J1 = USBC('full16', 'TYPE-C-31-M-12').connect({ GND, VBUS, DP, DN, CC1, CC2, SHIELD: GND, SBU1: NC, SBU2: NC })
route([J1.B6, J1.A7]).Z([U1.DP, U1.DM]).impedance(90)   // a pair from one pad each
route(J1['A4']).X('9 19.05')                              // one of the two VBUS pads
```

- A number is a pad number, never a list position; another key is a pin name, then a pad name: `J1.VBUS` is the pin on A4 and B4. A pad number that is its pin's name, `J1[3]` on a header, gives the pin; `.connect({ 4: N })` reads numbers alike.
- An unknown key throws a `SchematicError` naming the part, the nearest pin or pad and both lists. A pad handle naming no pad, or a number several pads share, is a compile error.
- A pin with several pads ends a route at the pad nearest the other end; a pad handle chooses.
- `.net` is the pin's net, also on a pad handle: `J1.DP.net` and `J1.B6.net` are `DP`; `NC` for an NC pin or pad; a `SchematicError` before `.connect()` or for a pin left out. `via(J1.B6, at)` takes that net.

## How pads get nets

A pad belongs to the pin named like its name, else its number, never by position; one matching no pin is a compile error naming footprint, pad and pins.

- `<pad num={4} nc … />` or the footprint's `nc` list: no net, no pin, no ERC finding; touching a net is a DRC `short`.
- Non-plated holes and unnumbered pads take no net.

## defineFootprint

`defineFootprint(render, meta)`: with JSX props carrying `ref` or `at` it renders; with a value, options or nothing it makes a part.

```tsx
import { defineFootprint, type FootprintProps } from '@pcbjs/core'
import { smd, courtyard } from '@pcbjs/lib'

function LDOFootprint({ children, ...rest }: FootprintProps) {
  return (
    <footprint id="my:SOT-23-5" value="LDO" {...rest}>
      {['VIN', 'GND', 'EN'].map((name, i) => smd(i + 1, -1.1, (i - 1) * 0.95, 1.06, 0.65, { name }))}
      {smd(4, 1.1, 0.95, 1.06, 0.65)}
      <pad num={5} name="VOUT" at="1.1 -0.95" size={[1.06, 0.65]} />
      {courtyard(3.4, 3.4)}
      {children}
    </footprint>
  )
}

export const LDO = defineFootprint(LDOFootprint, { pins: ['VIN', 'GND', 'EN', 'VOUT'], nc: ['4'], prefix: 'U', id: 'my:SOT-23-5' })
// LDO('AP2112K-3.3').connect({ VIN, GND, EN: VIN, VOUT: V3 })
```

| Meta | Meaning |
| --- | --- |
| `pins` | pin names in pin order, or a function of the props, as for `PinHeader` |
| `nc` | pad numbers or names left open; not also a pin |
| `pads` | pad numbers and names, inline or `as const`, so `LDO('x').EP` type-checks |
| `prefix` | ref prefix, letters only |
| `id`, `name` | optional |
| `symbol` | schematic symbol, schematic-graphic.md; default by prefix and pin names |

- Pass `{...rest}` through so `ref`, `at`, `side` and `net:*` reach `<footprint>`. `part(Footprint, options)` makes a part of any component with static `pins`, `nc` and `prefix`; stdlib footprints take `pinNames`.

## Typing rules

- Declare `pins` inline or as a constant `as const`; then `LDO('x').VIM` is an editor error.
- A `string[]` list, such as a `.map()` result, gives no named keys: the hint key `pin names are untyped`, and `U1.PA9` fails to type-check; `U1.pin('PA9')` and `connect({ … })` work at run time.
- `pads: [1, 2, 'EP']` inline or `as const` makes `U1.EP` a `PadRef<'EP'>` and `U1.EQ`, `U1[3]` errors; a pad id that is a pin name keeps the pin type. No numbers in `pads`: any number is a key; no `pads`: `U1.pad('EP')`.
- Generators type fixed pad ids, USB-C's `A1` to `B8`; on pads `1` to `n` any number is a key.
- `Part<any>` takes any key; avoid it. Positional `connect` is checked by count at run time only; past three pins use the object form.

## Plain footprints and strings

```tsx
<LED0603 ref="D1" net:A="LED1" net:K="SW" />
<PinHeader ref="J2" pins={3} net:pad1="SIG" net:pad2="GND" net:pad3="SW" />
<C0603 ref="C1" nets={{ 1: '+5V', 2: 'GND' }} />
```

- `net`, `net:*` and `nets` take strings. `pad<N>` is pad number N; another key matches the pad `num`, then `name`; none is a compile error. A footprint net overrides a pad's `net`.
- The rule `strictNets: true` makes a string net a compile error once the board uses parts or `Net` values; `"REF.PIN"` route ends stay allowed.
