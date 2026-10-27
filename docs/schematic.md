# Schematic

Nets and parts as values in a schematic module whose exports a board uses by name: `nets()`, footprint factories, `.connect`, pin and pad handles, `NC`, `defineFootprint` and its typing rules.
Circuits with ports are in circuits.md; ERC rule names are in findings.md.

## The schematic module

The recommended layout: the netlist in a module of its own, and the board passing it as a namespace to `<PCB schematic>`.

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

- Every export of that module, `export *` chains included, is in scope by its own name in the whole file that passes it: in the JSX, in `route()` calls and in functions. A name the file declares or imports itself wins, and so do globals such as `Math`.
- `sch.R1` names the same part. Parts and nets imported by name, `import { R1 } from './board.sch'`, work as before.
- One schematic namespace per file: two are an error asking for one file per board.
- `pcbjs check`, `dev` and `build` know the scope. Plain `tsc` does not and reports `Cannot find name 'R1'`; `pcbjs check` is the type check to trust.
- An export whose name is not the part's ref, `export const Rpull = …` numbered R3, is named `R3 (Rpull)` in findings, and `pcbjs inspect Rpull` finds it.
- The module's drawing export is the schematic picture, see schematic-graphic.md.

## Nets

```ts
import { nets, local, bus, NC } from '@pcbjs/core'

export const { GND, VCC, SIG } = nets()           // one Net per key read
export const { VIN } = nets({ VIN: { class: 'power' } })
export const D = bus('D', 8)                      // D0 to D7
export const P1 = nets('P1')                      // P1.CC1 is the net P1/CC1
```

- `nets()` returns a proxy. Reading a key gives the `Net` of that name, the same object for the same key from the same call.
- Inside a board two nets with the same name are one net, whichever call made them.
- A string first is a namespace prefix: `nets('P1').CC1` and `nets('P2').CC1` are two nets, `P1/CC1` and `P2/CC1`. Classes follow, keyed by the short name, `nets('P1', { VBUS: { class: 'power' } })`. The name is global: a `local('P1')` net or a circuit instance `P1` with a private `CC1` is the same net.
- `bus(name, n)` gives `n` nets named `name0` to `name<n-1>`.
- `local()` inside a component gives nets private to that instance, named after the instance path such as `Divider#2/mid`. Outside a component the scope is the label passed, `local('Chan')`.
- `net.rules({ clearance })` gives the net an anonymous class `net:<name>` of its own, its own class's fields with the rule on top, and returns the net: `GND.rules({ clearance: 0.3 })`. It is sugar for a class, see rules.md Overrides.
- `NC` marks a pin left open on purpose. A pin with neither a net nor `NC` is the ERC warning `unconnected-pin`.

## Parts

A footprint factory called with a value makes a `Part`. Placed as JSX it renders the footprint with the part's ref and nets.

```ts
const R1 = R0603('330').connect(VCC, LED)                       // nets in pin order
const D1 = LED0603('green').connect({ A: LED, K: GND })         // or by pin name
const J1 = PinHeader(3).connect({ 1: GND, 2: VCC, 3: SIG })     // or by pin number
const R2 = R0603('10k', { MPN: 'RC0603FR-0710KL' }).connect(VCC, SIG)
const R3 = R0603({ value: '1k', fields: { tolerance: '1%' } }).ref('R9').connect(SIG, GND)
```

- The options take `value`, `fields`, `source`, `bom`, `pos`, `description`, `height` and `model`. The second argument after a value is a sourcing spec, see sourcing.md.
- `.connect(...)` takes one `Net` or `NC` per pin in pin order, or one object keyed by pin name or pad number. A wrong count, an unknown pin, a pin connected twice or a string throws a `SchematicError`.
- `.ref('Q9')` pins an explicit ref. `.source({...})` adds sourcing keys. `.rules({ clearance, edgeClearance, holeClearance, trackWidth })` sets rule overrides for every pad of the part, see rules.md Overrides. All three return the same part.
- `.value`, `.prefix` and `.pins` read the part.
- Placement props are `at`, `side`, `fields`, `bom`, `pos`, `description`, `height`, `model`, `rules`, merged over `.rules()`, and children: `<R1 at="12 5" side="B" />`. `ref={false}` and `refAt` place or drop its silk ref, see layout.md Silk refs; any other `ref`, `nets` and `net:*` are compile errors on a part.
- A part placed twice on one board is a compile error. A module-level part in a file that placed parts, but not placed itself, is the ERC error `unplaced-part`.

## Refs

A part bound to a module-level `const` or `let` whose name is a ref, capital letters then digits such as `R1` or `LED3`, takes that name as its ref, as if `.ref(name)` had been called, whatever order the parts are declared in. The source transform of the dev server and the build records the name in the `.ts` and `.tsx` files under the project root.

- `.ref()` wins over the variable name: `const R3 = R0603('1k').ref('R9')` is R9.
- Two parts bound to one ref name on one board are a `SchematicError` naming both.
- A name that is not a ref, `const Rpull = …`, a destructured binding, a `var`, and a part made inside a function or circuit keep automatic numbering. `const R2 = R1` is an alias: the first name wins.
- The other parts are numbered per prefix in declaration order, each taking the lowest number not yet taken by a name, a `.ref()` or a written footprint.

Findings and `pcbjs inspect` print the ref, and for a part inside a circuit or a `group()` also its instance path, such as `R4 (CH2/R)`.

## Pin handles and pad handles

| Handle | Meaning |
| --- | --- |
| `D1.A`, `D1.pin('A')` | the pin named A |
| `U1[7]`, `U1['7']` | the pad numbered 7, whatever pin sits there; on an LED `D1[1]` is the K pad |
| `J1['B4']`, `J1.B4` | the pad numbered or named B4, a pad handle |
| `J1.pad('B4')` | the same pad, the fallback for a pad name that is also a pin name |

A number is a pad number, never a position in the pin list. Any other key is a pin name first, then a pad name of the footprint. So `J1.VBUS` is the pin on A4 and B4 and `J1.B4` is one of its pads. A key that is neither throws a `SchematicError` naming the part, the nearest pin or pad, and the pin and pad lists; an unknown number names the pad numbers.

A pad number that is also the name of the pin on that pad, such as `J1[3]` on a header, resolves to the pin handle. `.connect({ 4: N })` takes a number the same way: the pin on pad 4.

Handles are route ends: `route(J1[3]).X(Q1[1])`. A pin with several pads, such as `VBUS` on a USB-C receptacle, ends the route at its pad nearest the other end; a pad handle, `J1.B4`, chooses one. A pad handle that names no pad, or a number shared by several pads, is a compile error.

```ts
const J1 = USBC('full16', 'TYPE-C-31-M-12').connect({ GND, VBUS, DP, DN, CC1, CC2, SHIELD: GND, SBU1: NC, SBU2: NC })
route([J1.B6, J1.A7]).Z([U1.DP, U1.DM]).impedance(90)   // a pair from one pad each
route(J1['A4']).X('9 19.05')                              // one of the two VBUS pads
```

The string `"J1.3"` also works as a route end. It names a pad by number, then by name.

`.net` on a handle is the net its pin was connected to: `J1.DP.net` is `DP`, and for a pad handle the net of the pin the pad belongs to, so `J1.B6.net` is `DP` too. A pin connected to `NC`, or a pad marked nc, gives `NC`. Reading `.net` of a part not connected yet, or of a pin left out of `.connect()`, throws a `SchematicError` naming the part and the pin. `via(J1.B6, at)` takes the same net, see layout.md.

## How pads get nets

A placed part gives each pad the net of its pin. A pad belongs to the pin whose name equals the pad's name, else the pin equal to its number. Never by position.

- A pad that matches no declared pin is a compile error naming the footprint, the pad and the pins.
- A pad left open on purpose is marked NC: `<pad num={4} nc … />`, or its number or name in the footprint's `nc` list. An NC pad takes no net, belongs to no pin and raises no ERC finding.
- Non-plated holes and unnumbered pads take no net.
- An NC pad whose copper touches a net is a DRC `short`, as for any pad without a net.

## Writing a footprint for the schematic

`defineFootprint(render, meta)` makes a dual-mode factory. With JSX props carrying `ref` or `at` it renders. With a value, an options object or nothing it makes a part.

```tsx
import { defineFootprint, type FootprintProps } from '@pcbjs/core'
import { smd, courtyard } from '@pcbjs/lib'

function LDOFootprint(props: FootprintProps) {
  const { children, ...rest } = props
  return (
    <footprint id="my:SOT-23-5" value="LDO" {...rest}>
      <pad num={1} name="VIN" at="-1.1 -0.95" size={[1.06, 0.65]} />
      <pad num={2} name="GND" at="-1.1 0" size={[1.06, 0.65]} />
      <pad num={3} name="EN" at="-1.1 0.95" size={[1.06, 0.65]} />
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

- `pins` lists the pin names in pin order. It may be a function of the footprint props, as for `PinHeader`.
- `nc` lists pad numbers or names left unconnected on purpose. A name may not be both a pin and NC.
- `pads` lists the pad numbers and names, inline or `as const`, so that `LDO('x').EP` type-checks. It is for the editor only: at run time a part's pad keys come from its rendered footprint.
- `prefix` is the ref prefix, letters only. `id` and `name` are optional.
- Pass `{...rest}` through so `ref`, `at`, `side` and `net:*` reach `<footprint>`.
- `symbol` is the schematic symbol of its parts, see schematic-graphic.md; without it, the default by prefix and pin names.
- `part(Footprint, options)` makes a part from any component that carries static `pins`, `nc` and `prefix`.
- The generated standard-library footprints take `pinNames` instead, see stdlib.md.

## Typing rules

- Declare `pins` inline in the `defineFootprint` call, or as a constant `as const`. Then `LDO('x').VIN` type-checks and `LDO('x').VIM` is an editor error.
- A pin list widened to `string[]`, such as a `.map()` result, gives a part with no named keys: the editor shows the hint key `pin names are untyped`, and `U1.PA9` fails to type-check. `U1.pin('PA9')` and `connect({ … })` still work, checked at run time.
- Pad ids type the same way. With `pads: [1, 2, 'EP']` inline or `as const`, `U1.EP` is a `PadRef<'EP'>` and `U1.EQ` and `U1[3]` editor errors. A pad id that is a pin name keeps the pin handle type. Without numbers in `pads` any number is a key, checked at run time; without `pads`, `U1.pad('EP')` still works.
- The generators type their pad ids where they are fixed, such as the USB-C receptacle's `A1` to `B8`; on those numbered `1` to `n` any number is a key.
- `Part<any>` takes any key. Avoid it in board code.
- A positional `connect` is checked by count at run time, not by the editor. Prefer the object form for parts with more than three pins.

## Plain footprints and strings

Every `net` prop, `net:*` attribute and `nets` object also takes a string, so a board can mix plain footprints with parts:

```tsx
<LED0603 ref="D1" net:A="LED1" net:K="SW" />
<PinHeader ref="J2" pins={3} net:pad1="SIG" net:pad2="GND" net:pad3="SW" />
<C0603 ref="C1" nets={{ 1: '+5V', 2: 'GND' }} />
```

- A key `pad<N>` means pad number N, because JSX cannot spell `net:1`. Any other key matches the pad `num`, then its `name`.
- A footprint net overrides a `net` on the pad. A key that matches no pad is a compile error.
- The rule `strictNets: true` makes a string net anywhere a compile error once the board uses parts or `Net` values. `"REF.PIN"` route ends stay allowed.
