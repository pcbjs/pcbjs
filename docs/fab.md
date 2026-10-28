# Fab

Fab presets, custom presets with `bindPCB` and one design for several fabs with `variants`.
Every file of the fab set is in fab-set.md; stackup and rule values in board.md and rules.md; sourcing tags in sourcing.md.

```tsx
import PCB from '@pcbjs/fab/JLCPCB/2-Layer'

export default <PCB name="Blinky" revision="A" color="black" silk="white" finish="ENIG">{/* … */}</PCB>
```

## Presets

A `<PCB>` with the fab's stackup, rules and sourcing tags, plus three props:

| Prop | Takes |
| --- | --- |
| `color` | mask colour: a palette name in any case, `"matte green"`, or any CSS colour |
| `silk` | legend colour, the same way |
| `finish` | `'HASL'`, `'LeadFreeHASL'`, `'ENIG'`, `'ImmersionSilver'`, `'ImmersionTin'`, `'OSP'`, `'HardGold'` |

- Order: base, project defaults, preset, element props. `defineDefaultRules` never changes a preset's rules, `rules={{ clearance: 0.2 }}` merges over them, an explicit `stackup` replaces the preset's.
- JLCPCB `minHoleToHole: { pad: 0.45, via: 0.2 }`: the router keeps 0.45 between its vias, DRC lets hand-placed vias closer.
- JLCPCB at 1 oz: `maskWeb: 0.1`, `maskWebByColor: { Black: 0.13, White: 0.13 }`, picked by the mask colour of `<PCB>` or the target; README-fab prints `mask web 0.13, black mask`. A board `maskWeb` overrides it, 0.20 for 2 oz; other presets leave the rule out.

Modules are `@pcbjs/fab/<Fab>/<n>-Layer`:

| Fab | Rules | Modules: stackup, finish | Mask colours |
| --- | --- | --- | --- |
| `JLCPCB` | `JLCPCB` | `2-Layer`: `JLCPCB_2L`, HASL; `4-Layer`: `JLCPCB_4L_7628`, HASL; `4-Layer-3313`: `JLCPCB_4L_3313`, thin prepreg for fine-pitch impedance, HASL; `6-Layer`: `sixLayer`, ENIG; `8-Layer`: `eightLayer`, ENIG; all green | green, red, yellow, blue, white, black, purple |
| `PCBWay` | `PCBWAY` | `2-Layer`: `twoLayer`; `4-Layer`: `fourLayer`; HASL, green | the JLCPCB set, matte black, matte green |
| `OSHPark` | `OSHPARK` | `2-Layer`: `OSHPARK_2L`; `4-Layer`: `OSHPARK_4L`; ENIG, purple | purple |
| `Eurocircuits` | `EUROCIRCUITS` | `2-Layer`: `twoLayer`; `4-Layer`: `fourLayer`; lead-free HASL, green | green, red, blue, white, black |
| `AdvancedPCB` | `ADVANCEDPCB` | `2-Layer`: `twoLayer`; `4-Layer`: `fourLayer`; ENIG, black | green, red, blue, white, black |

Each module also exports `name`, `stackup`, `rules`, `colors`, `silkColors`, `finishes` and `sourcing`, frozen as `PCB.preset`; `@pcbjs/fab` exports `FABS`, every preset path.

## Your own preset

```tsx
import { bindPCB } from '@pcbjs/fab'
import { BASE, mergeRules } from '@pcbjs/lib/rules'
import { fourLayer } from '@pcbjs/lib/stackups'

const PCB = bindPCB({
  name: 'Local 4-Layer', fab: 'Local',
  stackup: fourLayer({ finish: 'ENIG', maskColor: 'Blue' }),
  rules: mergeRules(BASE, { clearance: 0.2, minTrackWidth: 0.2 }),
  colors: { Blue: '#173a7a', Black: '#1a1a1a' },
})

export default <PCB name="Probe" color="black">{/* … */}</PCB>
```

Also `silkColors`, `finishes`, `sourcing`, `autoroute`, `cpl` and `fabNotes`. `bindPCB({ ...PCB.preset, name: 'House 2-Layer' })` copies a preset; `isBoundPCB(fn)` tells a bound component from a plain one.

## Variants

```tsx
import { variants } from '@pcbjs/core'
import JLCPCB from '@pcbjs/fab/JLCPCB/2-Layer'
import OSHPark from '@pcbjs/fab/OSHPark/2-Layer'

const House = { name: 'House', board: { thickness: 1.2 }, rules: { clearance: 0.2 }, color: 'black', sourcing: ['US'] }
const PCB = variants(JLCPCB, OSHPark, House)

export default <PCB name="Multi" revision="A">{/* … */}</PCB>
```

One compile per target, each with its own DRC, fab set and viewer entry. A target is a preset, the plain `PCB` of `@pcbjs/core` named `Base`, or an object:

| Key | Takes |
| --- | --- |
| `name`, `fab` | strings; unnamed is `Target N`; a repeated name or slug throws |
| `board` | a partial `<PCB>` spec |
| `rules`, `color`, `silk`, `finish`, `sourcing`, `fabNotes` | as on a preset |
| `routeSeparately` | `true` routes this target on its own |

- The element's `rules`, `color`, `silk` and `finish` apply to every target.
- Targets with the same copper count and autoroute parameters share one routing under the strictest rules, so identical copper.
- `PCB.targets` holds the resolved targets; `isVariants(fn)` tells such a component apart; `compileBoards(root)` returns one board per target with `board.variant = { name, index, names, fab }`.
- Orderable only when every target is. The slug is the name in lower case, each run of other characters a `-`: `osh-park-2-layer`.

| What | Single board | Target |
| --- | --- | --- |
| fab set | `.pcbjs/fab/Multi/` | `.pcbjs/fab/Multi/<slug>/` |
| fab zip | `Multi-fab-<revision>.zip` | `Multi-fab-<revision>-<slug>.zip` |
| site data | `boards/Multi.json` | `boards/Multi/<slug>.json` |
| dev board data | `/__pcbjs/Multi/board.json` | `/__pcbjs/Multi/<slug>/board.json` |
