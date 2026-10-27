# Board

The `<PCB>` root and its props, units and coordinates, layer names, the stackup and project-wide defaults.
Fab presets that set all of this in one import are in fab.md; rule values are in rules.md.

## `<PCB>`

`<PCB>` from `@pcbjs/core`, or `<board>`, must be the root and appear once. A fab preset such as `@pcbjs/fab/JLCPCB/2-Layer` is a `<PCB>` with the stackup, rules and sourcing set, see fab.md.

The module that default-exports `<PCB>` is an entry, listed in `entries` in pcb.config.ts. The recommended name is `pcb.tsx` for a single board and `<board>.pcb.tsx` beside `<board>.sch.tsx` when a project has several; any name works and nothing checks it, but editors, the file icons and readers recognise these.

| Prop | Default | Meaning |
| --- | --- | --- |
| `name` | required | the board name: file names, URLs and the viewer key |
| `title` | `name` | the title the viewer shows |
| `revision` | `""` | goes into the fab zip name and README-fab |
| `copper` | 2 | copper layers, 2, 4, 6 or 8; the short form of `stackup` |
| `thickness` | 1.6 | board thickness in mm |
| `stackup` | generated | every physical layer, see Stackup below |
| `rules` | `BASE` | a partial rule set merged key by key over the defaults, see rules.md |
| `autoroute` | `BASE_BOARD.autoroute` | partial autoroute parameters merged key by key, see routing.md |
| `classes` | `{}` | net classes by name, `{ power: { width: 0.5 } }`, merged class by class and field by field, see routing.md |
| `strict` | false | a leg the router cannot route throws instead of becoming a `route-failed` finding |
| `sourcing` | `[]` | ordered sourcing tags, see sourcing.md |
| `cpl` | `{ origin: 'footprint' }`, `'center'` for JLCPCB presets | where `cpl.csv` places each part, see fab-set.md |
| `refStyle` | `"flat"` | `"hierarchical"` names circuit parts `BUCK1_R1`, see circuits.md |
| `schematic` | drawn by the compiler | the schematic module as a namespace, `import * as sch`, whose exports are in scope by name in the file, or a drawing, `<Schematic>` or `schematic({ … })`; see schematic.md and schematic-graphic.md |

A preset or `variants()` component also takes `color`, `silk` and `finish`, see fab.md.

## Units and coordinates

- The millimetre is the only unit inside pcbjs. Numbers are mm.
- Strings may carry a unit: `mm`, `cm`, `m`, `mil`, `th`, `in`, `um`, `nm`. Examples: `"5mm"`, `"100mil"`, `"0.1in"`.
- Rotations are degrees. Strings may use `deg`, `rad`, `turn` or `°`.
- `at` is `"x y"` or `"x y rot"`, separated by spaces or commas, or a tuple `[x, y]` or `[x, y, rot]`.
- The frame is SVG's, seen from the top: x right, y down. The origin is wherever you put it. The demo puts it at the top-left corner of the outline.
- Rotation is counter-clockwise on screen, as in KiCad. `at="15 7.5 90deg"` turns a part so its +x side points up and its +y side to +x: a `PinHeader(2)` at `at="10 10 90deg"` has pin 1 at (10, 10) and pin 2 at (12.54, 10).
- On `side="B"` the part is mirrored about its local y axis first and rotated after, still counter-clockwise on screen: a pad at local +x lands at -x, then turns with the rotation.
- KiCad flips a back part the other way, about its local x axis, top to bottom. The pads land at the same place when the pcbjs angle is the KiCad angle plus 180: a KiCad `B 0` is `side="B"` at 180deg here and a KiCad `B -90` is 90deg. kicad.md has more for ports.
- A 2-row header or socket on the back is mirrored too, so pin 2 lands on the other side of pin 1. One that mates through the board with a front header, such as a Pi HAT socket, needs its rows checked with `pcbjs inspect`.
- Gerber, drill and placement outputs flip y so it points up, as fabs expect.

Transforms compose. `<g>`, `<footprint>`, `<pad>` and `<text>` translate and rotate their content by `at`. `side="B"` on a group or footprint mirrors its content about its local y axis and swaps every `F.*` layer with its `B.*` twin, so a footprint written for the front lands correctly on the back. Two nested flips cancel. Sides are `F`, `top`, `front`, `B`, `bottom` and `back`.

`pcbjs inspect <entry> <ref>` prints where a part and its pads ended up, so you never compute a rotated pad by hand. See inspect.md.

## Layers

Names are KiCad's and case-insensitive.

| Layer | Aliases |
| --- | --- |
| `F.Cu` | `top`, `front` |
| `In1.Cu` to `In6.Cu` | inner copper: In1 and In2 on 4 layers, up to In6 on 8 |
| `B.Cu` | `bottom`, `back` |
| `F.SilkS`, `B.SilkS` | `silk` for the front, `F.Silk`, `F.Silkscreen`, `B.Silk`, `B.Silkscreen` |
| `F.Mask`, `B.Mask` | |
| `F.Paste`, `B.Paste` | |
| `F.Fab`, `B.Fab` | |
| `F.CrtYd`, `B.CrtYd` | `F.Courtyard`, `B.Courtyard` |
| `Edge.Cuts` | `edge`, `outline`, `Edge.Cut` |
| `Dwgs.User` | `User.Drawings` |
| `Cmts.User` | `User.Comments` |

- Side-relative names flip inside a back-side parent: `F.Cu` in a footprint with `side="B"` becomes `B.Cu`, and so do `top` and `front`.
- Mask and paste come from pads. A pad on `F.Cu` gets an `F.Mask` opening grown by `maskExpansion`. An SMD pad with `paste` gets an `F.Paste` shape shrunk by `pasteShrink`.
- The outline is every item on `Edge.Cuts`, chained into closed rings with a 0.01 mm tolerance. A cutout is a closed shape inside it.

## Stackup

A board has a stackup: its physical layers top to bottom, the finish, and the mask and silk colours. `copper={4}` generates one sized to `thickness`. `stackup={…}` gives every layer. The compiled board always holds one in `board.stackup`.

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

Thicknesses are mm, `weight` is copper in oz with 1 oz = 0.035 mm, `er` is the dielectric constant.

```tsx
import PCB from '@pcbjs/core'
import { JLCPCB_4L_7628 } from '@pcbjs/lib/stackups'

export default <PCB name="Quad" stackup={JLCPCB_4L_7628}>{/* … */}</PCB>
```

`@pcbjs/lib/stackups` has:

- `twoLayer`, `fourLayer`, `sixLayer` and `eightLayer`, which take `thickness`, `outerCopper` and `innerCopper` in oz, `prepreg` in mm, `finish`, `maskColor`, `silkColor`, `material`, `er` and `lossTangent`. Defaults: 1.6 mm, 1 oz outer, 0.5 oz inner, FR4 at er 4.5, green mask, white legend.
- `JLCPCB_2L`, `JLCPCB_4L_7628`, `OSHPARK_2L` and `OSHPARK_4L`, frozen fab stackups. Spread one into a new object to change it.
- `defaultStackup(copper, thickness)`, what `copper={n}` generates.

The compiler checks a stackup before using it. Each failure is a compile error naming the layer:

- copper runs F.Cu, In1.Cu and so on, B.Cu, with 2, 4, 6 or 8 layers;
- a core or prepreg sits between every two copper layers;
- front mask, silk and paste sit above F.Cu, back ones below B.Cu;
- a nominal `thickness` is within 10% of the sum of the layers;
- with both `copper` and `stackup` they agree on the count, and a `thickness` next to a stackup matches it.

The stackup goes into the Gerber job file and README-fab, and colours the 3D view. stackup-and-rules.md has the layer tables of the builders and the sources of every preset.

## Defaults

A board resolves in levels, lowest first:

1. `BASE_BOARD`: 2 copper layers, the generated stackup, 1.6 mm, revision `""`, `BASE_RULES`, the base autoroute parameters, no net classes.
2. The project defaults, from `defineDefaultBoard` and `defineDefaultRules`.
3. A fab preset or variant target, when the board uses one.
4. The props of `<PCB>`.

A key at a higher level wins. `rules` and `autoroute` merge key by key through every level, and `classes` by class name, then field by field. `copper`, `stackup` and `thickness` resolve after the merge: the highest level that gives `copper` or `stackup` decides the layers.

```ts
// pcb.config.ts
import { defineConfig, defineDefaultBoard, defineDefaultRules } from '@pcbjs/core'
import { JLCPCB } from '@pcbjs/lib/rules'
import { JLCPCB_4L_7628 } from '@pcbjs/lib/stackups'

defineDefaultBoard({ stackup: JLCPCB_4L_7628, revision: 'A' })
defineDefaultRules(JLCPCB)

export default defineConfig({})
```

- `defineDefaultBoard(spec)` takes every `<PCB>` prop but `name` and `children`, replaces any earlier default board and returns the resolved default, frozen. It throws when the stackup disagrees with `copper` or `thickness`.
- `defineDefaultRules(rules)` takes a partial rule set, replaces any earlier default rules and returns the full set, frozen. It sits above the `rules` of `defineDefaultBoard`.
- A second call replaces the first. To build on an earlier default, spread the returned value into the next call.
- `resetDefaults()` clears both. `BASE_BOARD` and `BASE_RULES` are the frozen base level.

The defaults are one registry per Node process, not per board. Call them in `pcb.config.ts` or in a module every entry imports. A module only one entry imports also changes every board compiled after it in the same build or dev server.
