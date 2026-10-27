# Fab

Fab presets, custom presets with `bindPCB` and one design for several fabs with `variants`.
Every file of the fab set is in fab-set.md; stackup and rule values in board.md and rules.md; sourcing tags in sourcing.md.

## Presets

A fab preset is a `<PCB>` with the fab's stackup, rules and sourcing tags set. Each is its own module:

```tsx
import PCB from '@pcbjs/fab/JLCPCB/2-Layer'

export default <PCB name="Blinky" revision="A" color="black">{/* … */}</PCB>
```

It takes every `<PCB>` prop and three more:

- `color`, the mask colour: a name from the fab's palette in any case, such as `"black"` or `"matte green"`, or any CSS colour, passed through as given.
- `silk`, the legend colour, matched the same way.
- `finish`: `'HASL'`, `'LeadFreeHASL'`, `'ENIG'`, `'ImmersionSilver'`, `'ImmersionTin'`, `'OSP'` or `'HardGold'`.

A board resolves as the base, then the project defaults, then the preset, then the element's props. `defineDefaultRules` never changes a preset's rules. `rules={{ clearance: 0.2 }}` on the element merges over the preset rules. An explicit `stackup` replaces the preset's.

The JLCPCB presets carry hole to hole as JLCPCB states it, `minHoleToHole: { pad: 0.45, via: 0.2 }`: two vias may sit 0.2 mm apart edge to edge, any other two holes 0.45 mm. The router keeps 0.45 between its vias as before; DRC lets hand-placed vias closer, see rules.md Hole rules by side.

The JLCPCB presets carry JLCPCB's soldermask bridge at 1 oz by mask colour: `maskWeb: 0.1` for green, the presets' mask, and red, yellow, blue and purple, and `maskWebByColor: { Black: 0.13, White: 0.13 }`. The mask colour picks the value, `<PCB color="black">` on the preset or `color` on a variant target checks 0.13, and README-fab prints it with the colour, `mask web 0.13, black mask`. A `maskWeb` set on the board overrides the colour, as for 2 oz copper, which JLCPCB holds to 0.20 in any colour. The other presets state no mask web and leave the rule out, see rules.md Mask web.

| Module | Stackup | Rules | Mask colours |
| --- | --- | --- | --- |
| `@pcbjs/fab/JLCPCB/2-Layer` | `JLCPCB_2L`, HASL, green | `JLCPCB` | green, red, yellow, blue, white, black, purple |
| `@pcbjs/fab/JLCPCB/4-Layer` | `JLCPCB_4L_7628`, HASL, green | `JLCPCB` | the same |
| `@pcbjs/fab/JLCPCB/4-Layer-3313` | `JLCPCB_4L_3313`, thin 3313 prepreg for impedance at fine pitch, HASL, green | `JLCPCB` | the same |
| `@pcbjs/fab/JLCPCB/6-Layer` | `sixLayer`, ENIG, green | `JLCPCB` | the same |
| `@pcbjs/fab/JLCPCB/8-Layer` | `eightLayer`, ENIG, green | `JLCPCB` | the same |
| `@pcbjs/fab/PCBWay/2-Layer` | `twoLayer`, HASL, green | `PCBWAY` | the JLCPCB set, matte black, matte green |
| `@pcbjs/fab/PCBWay/4-Layer` | `fourLayer`, HASL, green | `PCBWAY` | the same |
| `@pcbjs/fab/OSHPark/2-Layer` | `OSHPARK_2L`, ENIG, purple | `OSHPARK` | purple |
| `@pcbjs/fab/OSHPark/4-Layer` | `OSHPARK_4L`, ENIG, purple | `OSHPARK` | purple |
| `@pcbjs/fab/Eurocircuits/2-Layer` | `twoLayer`, lead-free HASL, green | `EUROCIRCUITS` | green, red, blue, white, black |
| `@pcbjs/fab/Eurocircuits/4-Layer` | `fourLayer`, lead-free HASL, green | `EUROCIRCUITS` | the same |
| `@pcbjs/fab/AdvancedPCB/2-Layer` | `twoLayer`, ENIG, black | `ADVANCEDPCB` | green, red, blue, white, black |
| `@pcbjs/fab/AdvancedPCB/4-Layer` | `fourLayer`, ENIG, black | `ADVANCEDPCB` | the same |

Each preset module also exports `name`, `stackup`, `rules`, `colors`, `silkColors`, `finishes` and `sourcing`. The component carries the same as a frozen `PCB.preset`, which spreads back into `bindPCB` as it is, `bindPCB({ ...PCB.preset, name: 'House 2-Layer' })`, its lists and palettes included. `@pcbjs/fab` exports `FABS`, every preset path.

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

`bindPCB` also takes `silkColors`, `finishes`, `sourcing`, `autoroute`, `cpl` and `fabNotes`. `isBoundPCB(fn)` tells a bound component from a plain one.

## Variants

`variants(...)` turns one design into a board for several fabs. The design compiles once per target, and each target gets its own DRC, fab set and viewer entry.

```tsx
import { variants } from '@pcbjs/core'
import JLCPCB from '@pcbjs/fab/JLCPCB/2-Layer'
import OSHPark from '@pcbjs/fab/OSHPark/2-Layer'

const House = { name: 'House', board: { thickness: 1.2 }, rules: { clearance: 0.2 }, color: 'black', sourcing: ['US'] }
const PCB = variants(JLCPCB, OSHPark, House)

export default <PCB name="Multi" revision="A">{/* … */}</PCB>
```

A target is:

- a fab preset, which brings its name, fab, stackup, rules, palettes and tags;
- a plain object `{ name, board, rules, color, silk, finish, fab, sourcing, fabNotes, routeSeparately }`, every key optional, where `board` is a partial `<PCB>` spec;
- the plain `PCB` from `@pcbjs/core`, named `Base`.

- A target without a name is `Target N`. Two targets with the same name or slug are a compile error.
- Each target resolves like a preset. The element's `rules`, `color`, `silk` and `finish` apply to every target.
- Targets with the same copper count and autoroute parameters share one routing under the strictest of their rules, so their copper is identical. `routeSeparately: true` opts a target out. See autorouter.md.
- `PCB.targets` holds the resolved targets. `isVariants(fn)` tells such a component apart. `compileBoards(root)` returns one board per target with `board.variant = { name, index, names, fab }`.
- A board with variants is orderable only when every target is.

A target's slug is its name in lower case, each run of other characters a `-`: `OSH Park 2-Layer` is `osh-park-2-layer`.

| What | Single board | Target of a board with variants |
| --- | --- | --- |
| fab set | `.pcbjs/fab/Multi/` | `.pcbjs/fab/Multi/<slug>/` |
| fab zip | `Multi-fab-<revision>.zip` | `Multi-fab-<revision>-<slug>.zip` |
| site data | `boards/Multi.json` | `boards/Multi/<slug>.json` |
| dev board data | `/__pcbjs/Multi/board.json` | `/__pcbjs/Multi/<slug>/board.json` |
