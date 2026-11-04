# Sourcing

What to order for each part: `MPN` and `MPN:<tag>` keys and BOM fields given by `.source()`, sourcing tags on boards and fab targets, and the BOM they resolve to.
Advanced. `.source()` is called on the part where it is made, or out of line in a separate `<board>.sourcing.ts` module.

```ts
export const R1 = R0603('330').source({ MPN: 'RC0603FR-07330RL', 'MPN:LCSC': 'C23138' }).connect({ 1: VCC, 2: LED1 })
```

## Keys

| Key | Meaning |
| --- | --- |
| `MPN` | the catch-all part number |
| `MPN:<tag>` | the number for one source: `MPN:LCSC`, `MPN:DigiKey`, `MPN:Mouser`, `MPN:US`, `MPN:CN`; free strings matched as written, `MPN` in capitals |
| any other, `Manufacturer`, `Datasheet`, `Description` | a plain BOM field |

The keys are typed as `SourcingSpec`. `Description` is the part's description in the BOM.

## Inline

```ts
export const Q1 = SOT23(3)('MMBT3904').source({ MPN: 'MMBT3904LT1G', Manufacturer: 'onsemi' }).connect({ 1: SIG, 2: GND, 3: SW })
export const R2 = R0603('330').source({ 'MPN:LCSC': 'C23138', Tolerance: '1%' }).connect({ 1: VCC, 2: LED2 })
```

Several `.source()` calls merge, a later key replacing an earlier one.

## Out of line

```ts
// blinky.sourcing.ts, imported by blinky.pcb.tsx with import './blinky.sourcing'
import { J1, C1, CH1, CH2, CH3 } from './blinky.sch'

const R330 = { MPN: 'RC0603FR-07330RL', 'MPN:LCSC': 'C23138' }
for (const ch of [CH1, CH2, CH3]) ch.R.source(R330)       // the resistor of each channel
C1.source({ MPN: 'CL10B104KB8NNNC', 'MPN:LCSC': 'C14663' })
J1.source({ MPN: 'PEC03SAAN', Manufacturer: 'Sullins' })
```

A plain object of keys shared by several parts is a constant like any other.

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
