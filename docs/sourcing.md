# Sourcing

What to order for each part: `MPN` and `MPN:<tag>` keys on parts, sourcing tags on boards and fab targets, and the BOM they resolve to.
Write part numbers inline or in a separate `<board>.sourcing.ts` module of `source()` calls.

```ts
export const R1 = R0603('330', { MPN: 'RC0603FR-07330RL', 'MPN:LCSC': 'C23138' }).connect(VCC, LED1)
```

## Keys

| Key | Meaning |
| --- | --- |
| `MPN` | the catch-all part number |
| `MPN:<tag>` | the number for one source: `MPN:LCSC`, `MPN:DigiKey`, `MPN:Mouser`, `MPN:US`, `MPN:CN`; free strings, case-insensitive |
| any other, `Manufacturer`, `Datasheet`, `Description` | a plain BOM field |

The keys are typed as `SourcingSpec`.

## Inline

The second argument of a factory, the `source` option, or `.source()`:

```ts
export const Q1 = SOT23(3)('MMBT3904', { MPN: 'MMBT3904LT1G', Manufacturer: 'onsemi' }).connect(SIG, GND, SW)
export const R2 = R0603({ value: '330', source: { MPN: 'RC0603FR-07330RL' } }).source({ 'MPN:LCSC': 'C23138' }).connect(VCC, LED2)
```

## Out of line

```ts
// blinky.sourcing.ts, imported by blinky.pcb.tsx with import './blinky.sourcing'
import { source } from '@pcbjs/core'
import { R0603 } from '@pcbjs/lib'
import { J1, C1 } from './blinky.sch'

source(R0603, '330', { MPN: 'RC0603FR-07330RL', 'MPN:LCSC': 'C23138' })   // every R0603 with value 330
source(C1, { MPN: 'CL10B104KB8NNNC', 'MPN:LCSC': 'C14663' })              // one part, an instance, or an array
source(J1, { MPN: 'PEC03SAAN', Manufacturer: 'Sullins' })
```

Merge order, a later key replacing an earlier one:

1. `source(factory, value, spec)` rules, in call order; they reach only boards whose entry imports the module.
2. `source(part, spec)` calls, in call order.
3. The part options: `fields`, then `source` or the second argument.
4. `.source()` calls.
5. The placement's `fields`, `<R1 at="12 5" fields={{ … }} />`; plain footprints take keys this way.

## Tags on the board

`sourcing` on `<PCB>` is an ordered tag list, resolved like every board setting: `[]`, `defineDefaultBoard`, preset or target, prop.

| Fab preset | Tags |
| --- | --- |
| JLCPCB | `['LCSC', 'CN']` |
| PCBWay | `['CN']` |
| OSH Park | `['DigiKey', 'US']` |
| Eurocircuits | `['Mouser', 'EU']` |
| Advanced PCB | `['DigiKey', 'US']` |

A BOM row takes its first `MPN:<tag>` in tag order, else `MPN`, else nothing. With `variants(JLCPCB, OSHPark, { name: 'House' })` a resistor orders its LCSC code from JLCPCB, its DigiKey or US number from OSH Park and its `MPN` from House; a plain target sets `sourcing: ['US']`.

## Checks and outputs

| What | Result |
| --- | --- |
| rule `requireSourcing: true` | a row with no part number is the ERC warning `unsourced-part` |
| a row whose only keys are tags the board lacks | ERC warning `unsourced-target`, when the board has tags |
| `bom.csv` | the resolved number in `MPN`, the tag in `Source`, see fab-set.md |
| README-fab | `Sourcing: tags LCSC, CN; 3 rows, 0 without a part number` |
| `resolveSourcing(fields, tags)` | `{ mpn, tag, all, manufacturer?, datasheet? }`; `tag` is `""` for the catch-all, null for no match |
