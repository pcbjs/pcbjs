# Sourcing

What to order for each part: `MPN` and `MPN:<tag>` keys on parts, sourcing tags on boards and fab targets, and the BOM they resolve to.
Write part numbers inline or in a separate `<board>.sourcing.ts` module of `source()` calls.

## Keys

- `MPN` is the catch-all part number.
- `MPN:<tag>` is the part number for one named source, such as `MPN:LCSC`, `MPN:DigiKey`, `MPN:Mouser`, `MPN:US` or `MPN:CN`. Tags are free strings compared without case.
- Every other key, such as `Manufacturer`, `Datasheet` or `Description`, is a plain BOM field.
- The keys are typed as `SourcingSpec`, so the editor completes them.

## Inline

The spec is the second argument of a factory, the `source` option, or a `.source()` call:

```ts
export const Q1 = SOT23(3)('MMBT3904', { MPN: 'MMBT3904LT1G', Manufacturer: 'onsemi' }).connect(SIG, GND, SW)
export const R1 = R0603('330', { MPN: 'RC0603FR-07330RL', 'MPN:LCSC': 'C23138' }).connect(VCC, LED1)
export const R2 = R0603({ value: '330', source: { MPN: 'RC0603FR-07330RL' } }).source({ 'MPN:LCSC': 'C23138' }).connect(VCC, LED2)
```

## Out of line

`source()` from `@pcbjs/core` sets keys from any module the entry imports:

```ts
// blinky.sourcing.ts, imported by blinky.pcb.tsx with import './blinky.sourcing'
import { source } from '@pcbjs/core'
import { R0603 } from '@pcbjs/lib'
import { J1, C1 } from './blinky.sch'

source(R0603, '330', { MPN: 'RC0603FR-07330RL', 'MPN:LCSC': 'C23138' })   // every R0603 with value 330
source(C1, { MPN: 'CL10B104KB8NNNC', 'MPN:LCSC': 'C14663' })              // one part, an instance, or an array
source(J1, { MPN: 'PEC03SAAN', Manufacturer: 'Sullins' })
```

The keys merge at compile time, lowest first, a later key replacing an earlier one:

1. `source(factory, value, spec)` rules, in call order.
2. `source(part, spec)` calls, in call order.
3. The part options: `fields`, then `source` or the second argument.
4. `.source()` calls on the part.
5. The `fields` of the placement, `<R1 at="12 5" fields={{ … }} />`.

A factory rule reaches only boards whose entry imports the module that made it. Plain footprints take the same keys through `fields`.

## Tags on the board

A board or fab target carries an ordered list of tags, `sourcing` on `<PCB>`. It resolves like every board setting: `[]` at the base, then `defineDefaultBoard`, then the preset or target, then the prop.

| Fab preset | Tags |
| --- | --- |
| JLCPCB | `['LCSC', 'CN']` |
| PCBWay | `['CN']` |
| OSH Park | `['DigiKey', 'US']` |
| Eurocircuits | `['Mouser', 'EU']` |
| Advanced PCB | `['DigiKey', 'US']` |

Each BOM row resolves to the first `MPN:<tag>` it has in tag order, else its `MPN`, else nothing. With `variants(JLCPCB, OSHPark, { name: 'House' })` a resistor orders its LCSC code from JLCPCB, its DigiKey or US number from OSH Park and its `MPN` from House. A plain target sets tags with `sourcing: ['US']`.

## Checks and outputs

- The rule `requireSourcing: true` makes a BOM row without any part number the ERC warning `unsourced-part`.
- A row whose only keys are tags the board does not list is the ERC warning `unsourced-target`, whenever the board has tags.
- `bom.csv` gets the resolved number in `MPN` and the matched tag in `Source`, see fab-set.md.
- README-fab has a line such as `Sourcing: tags LCSC, CN; 3 rows, 0 without a part number`.
- `resolveSourcing(fields, tags)` from `@pcbjs/core` returns `{ mpn, tag, all, manufacturer?, datasheet? }` for any fields. `tag` is `""` for the catch-all and null when nothing matched.
