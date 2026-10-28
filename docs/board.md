# Board

The `<PCB>` root and its props, units and coordinates, layer names, the stackup and project-wide defaults.
Fab presets that set all of this in one import are in fab.md; rule values are in rules.md.

```tsx
import PCB from '@pcbjs/core'

export default (
  <PCB name="Blinky" revision="A" copper={2} thickness={1.6}>
    <rect layer="edge" x={0} y={0} w="30mm" h="20mm" />
  </PCB>
)
```

## `<PCB>`

The root, once per entry; `<board>` is the same. The module that default-exports it is an entry, listed in `entries` in pcb.config.ts. Names are free; editors and readers recognise `pcb.tsx` for one board and `<board>.pcb.tsx` beside `<board>.sch.tsx` for several.

| Prop | Default | Meaning |
| --- | --- | --- |
| `name` | required | file names, URLs and the viewer key |
| `title` | `name` | what the viewer shows |
| `revision` | `""` | in the fab zip name and README-fab |
| `copper` | 2 | 2, 4, 6 or 8 copper layers; short form of `stackup` |
| `thickness` | 1.6 | mm |
| `stackup` | generated | every physical layer, see Stackup |
| `rules` | `BASE` | partial rule set merged key by key, see rules.md |
| `autoroute` | `BASE_BOARD.autoroute` | partial parameters merged key by key, see routing.md |
| `classes` | `{}` | net classes, `{ power: { width: 0.5 } }`, merged by class then field, see routing.md |
| `strict` | false | a leg the router cannot route throws instead of a `route-failed` finding |
| `sourcing` | `[]` | ordered sourcing tags, see sourcing.md |
| `cpl` | `{ origin: 'footprint' }`, `'center'` for JLCPCB presets | where `cpl.csv` places a part, see fab-set.md |
| `refStyle` | `"flat"` | `"hierarchical"` names circuit parts `BUCK1_R1`, see circuits.md |
| `schematic` | drawn by the compiler | the schematic module as a namespace, `import * as sch`, whose exports are then in scope by name, or a drawing, `<Schematic>` or `schematic({ … })`; see schematic-graphic.md |

A preset such as `@pcbjs/fab/JLCPCB/2-Layer` is a `<PCB>` with stackup, rules and sourcing set; it and `variants()` also take `color`, `silk` and `finish`, see fab.md.

## Units and coordinates

| What | Form |
| --- | --- |
| length | number in mm, or a string with `mm`, `cm`, `m`, `mil`, `th`, `in`, `um`, `nm`: `"100mil"`, `"0.1in"` |
| angle | degrees, or a string with `deg`, `rad`, `turn` or `°` |
| `at` | `"x y"` or `"x y rot"`, spaces or commas, or `[x, y]`, `[x, y, rot]` |
| frame | SVG's, seen from the top: x right, y down, origin where you put it |
| rotation | counter-clockwise on screen, as in KiCad |
| side | `F`, `top`, `front`, `B`, `bottom`, `back` |

- A `PinHeader(2)` at `at="10 10 90deg"` has pin 1 at (10, 10) and pin 2 at (12.54, 10): its +x side points up.
- `side="B"` mirrors about the local y axis first, then rotates. KiCad mirrors about local x, so a KiCad `B 0` is `side="B"` at 180deg here and `B -90` is 90deg; see kicad.md.
- A 2-row header on the back is mirrored too; check one that mates through the board with `pcbjs inspect`.
- `<g>`, `<footprint>`, `<pad>` and `<text>` translate and rotate their content by `at`. `side="B"` on a group or footprint mirrors it and swaps every `F.*` layer with its `B.*` twin; two nested flips cancel.
- Gerber, drill and placement outputs flip y to point up.
- `pcbjs inspect <entry> <ref>` prints where pads ended up, see inspect.md.

## Layers

KiCad's names, case-insensitive.

| Layer | Aliases |
| --- | --- |
| `F.Cu` | `top`, `front` |
| `In1.Cu` to `In6.Cu` | In1, In2 on 4 layers, up to In6 on 8 |
| `B.Cu` | `bottom`, `back` |
| `F.SilkS`, `B.SilkS` | `silk` for the front, `F.Silk`, `F.Silkscreen`, `B.Silk`, `B.Silkscreen` |
| `F.Mask`, `B.Mask` | |
| `F.Paste`, `B.Paste` | |
| `F.Fab`, `B.Fab` | |
| `F.CrtYd`, `B.CrtYd` | `F.Courtyard`, `B.Courtyard` |
| `Edge.Cuts` | `edge`, `outline`, `Edge.Cut` |
| `Dwgs.User` | `User.Drawings` |
| `Cmts.User` | `User.Comments` |

- `F.Cu`, `top` and `front` become `B.Cu` inside a `side="B"` parent.
- Mask and paste come from pads: an `F.Mask` opening grown by `maskExpansion`, and for an SMD pad with `paste` an `F.Paste` shape shrunk by `pasteShrink`.
- The outline is every `Edge.Cuts` item chained into closed rings, 0.01 mm tolerance; a closed shape inside is a cutout.

## Stackup

```tsx
import PCB from '@pcbjs/core'
import { JLCPCB_4L_7628 } from '@pcbjs/lib/stackups'

export default <PCB name="Quad" stackup={JLCPCB_4L_7628}>{/* … */}</PCB>
```

```ts
interface Stackup {
  layers: StackupLayer[]   // top to bottom
  finish?: 'HASL' | 'LeadFreeHASL' | 'ENIG' | 'ImmersionSilver' | 'ImmersionTin' | 'OSP' | 'HardGold'
  maskColor?: string
  silkColor?: string
  thickness?: number       // nominal ordered thickness; default the sum of the layers
}

type StackupLayer =
  | { type: 'copper'; name: 'F.Cu' | 'B.Cu' | `In${number}.Cu`; thickness: number; weight?: number }
  | { type: 'core' | 'prepreg'; material?: string; thickness: number; er?: number; lossTangent?: number }
  | { type: 'mask' | 'silk' | 'paste'; side: 'F' | 'B'; thickness?: number; color?: string }
```

Thicknesses in mm, `weight` in oz copper with 1 oz = 0.035 mm, `er` the dielectric constant. The compiled board always holds one in `board.stackup`; it goes into the Gerber job file and README-fab and colours the 3D view.

| From `@pcbjs/lib/stackups` | What |
| --- | --- |
| `twoLayer`, `fourLayer`, `sixLayer`, `eightLayer` | take `thickness`, `outerCopper`, `innerCopper` in oz, `prepreg` in mm, `finish`, `maskColor`, `silkColor`, `material`, `er`, `lossTangent`; defaults 1.6 mm, 1 oz outer, 0.5 oz inner, FR4 at er 4.5, green mask, white legend |
| `JLCPCB_2L`, `JLCPCB_4L_7628`, `OSHPARK_2L`, `OSHPARK_4L` | frozen fab stackups; spread into a new object to change |
| `defaultStackup(copper, thickness)` | what `copper={n}` generates |

A compile error names the layer unless:

- copper runs F.Cu, In1.Cu and on, B.Cu, with 2, 4, 6 or 8 layers;
- a core or prepreg sits between every two copper layers;
- front mask, silk and paste sit above F.Cu, back ones below B.Cu;
- a nominal `thickness` is within 10% of the sum of the layers;
- `copper` and `stackup` agree on the count, and a `thickness` beside a stackup matches it.

stackup-and-rules.md has the builders' layer tables and every preset's source.

## Defaults

```ts
// pcb.config.ts
import { defineConfig, defineDefaultBoard, defineDefaultRules } from '@pcbjs/core'
import { JLCPCB } from '@pcbjs/lib/rules'
import { JLCPCB_4L_7628 } from '@pcbjs/lib/stackups'

defineDefaultBoard({ stackup: JLCPCB_4L_7628, revision: 'A' })
defineDefaultRules(JLCPCB)

export default defineConfig({})
```

Levels, lowest first; a higher level wins:

1. `BASE_BOARD`: 2 copper layers, generated stackup, 1.6 mm, revision `""`, `BASE_RULES`, base autoroute parameters, no net classes.
2. `defineDefaultBoard` and `defineDefaultRules`.
3. A fab preset or variant target.
4. The props of `<PCB>`.

`rules` and `autoroute` merge key by key, `classes` by class then field. `copper`, `stackup` and `thickness` resolve after the merge: the highest level giving `copper` or `stackup` decides the layers.

| Call | Does |
| --- | --- |
| `defineDefaultBoard(spec)` | every `<PCB>` prop but `name` and `children`; replaces the earlier default, returns it resolved and frozen; throws when the stackup disagrees with `copper` or `thickness` |
| `defineDefaultRules(rules)` | partial rule set above the `rules` of `defineDefaultBoard`; replaces the earlier one, returns the full set frozen |
| `resetDefaults()` | clears both |
| `BASE_BOARD`, `BASE_RULES` | the frozen base level |

A second call replaces the first; spread the returned value to build on it. The registry is one per Node process, so call them in `pcb.config.ts` or a module every entry imports.
