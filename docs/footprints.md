# Footprints

Your own footprint factories with `defineFootprint`, `part()` and `withPins`, and the typing rules that keep pin and pad names checked by the editor.
Advanced. Placing and connecting parts is in schematic.md; every footprint of the standard library and the footprint helpers in stdlib.md; KiCad footprints in import.md.

`defineFootprint(render, meta)` makes a footprint factory: its call makes a part, named after the render function.

```tsx
import { defineFootprint, type FootprintProps } from '@pcbjs/core'
import { smd, courtyard } from '@pcbjs/lib'

export const LDO = defineFootprint(function LDO({ children, ...rest }: FootprintProps) {
  return (
    <footprint id="my:SOT-23-5" value="LDO" {...rest}>
      {['VIN', 'GND', 'EN'].map((name, i) => smd(i + 1, -1.1, (i - 1) * 0.95, 1.06, 0.65, { name }))}
      {smd(4, 1.1, 0.95, 1.06, 0.65)}
      <pad num={5} name="VOUT" at="1.1 -0.95" size={[1.06, 0.65]} />
      {courtyard(3.4, 3.4)}
      {children}
    </footprint>
  )
}, { pins: ['VIN', 'GND', 'EN', 'VOUT'], nc: ['4'], prefix: 'U' })
// LDO('AP2112K-3.3').connect({ VIN, GND, EN: VIN, VOUT: V3 })
```

| Meta | Meaning |
| --- | --- |
| `pins` | pin names, or a function of the props, as for `PinHeader` |
| `nc` | pad numbers or names left open; not also a pin |
| `pads` | pad numbers and names, inline or `as const`, so `LDO('x').EP` type-checks |
| `prefix` | ref prefix, letters only |
| `symbol` | schematic symbol, schematic-graphic.md; default by prefix and pin names |

- The footprint's `id`, `netTie`, `bom`, `pos` and `description` are props of `<footprint>`. Pass `{...rest}` through so `ref`, `at` and `side` reach it.
- `<footprint>` draws a part's footprint; one outside a part is a compile error. `part(Footprint, options)` makes a part of any component with static `pins`, `nc` and `prefix`; `withPins` renames the pins of a stdlib footprint.

## Typing rules

- Declare `pins` inline or as a constant `as const`; then `LDO('x').VIM` is an editor error.
- A `string[]` list, such as a `.map()` result, gives no named keys: the hint key `pin names are untyped`, and `U1.PA9` fails to type-check; `connect({ … })` works at run time.
- `pads: [1, 2, 'EP']` inline or `as const` makes `U1.EP` a `PadRef<'EP'>` and `U1.EQ`, `U1[3]` errors; a pad id that is a pin name keeps the pin type. No numbers in `pads`: any number is a key.
- Generators type fixed pad ids, USB-C's `A1` to `B8`; on pads `1` to `n` any number is a key.
- `Part<any>` takes any key; avoid it.
