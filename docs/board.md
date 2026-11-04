# Board

The `<PCB>` root and its props, units and coordinates, and layer names.
Basic. The stackup and project-wide defaults are in stackup.md, fab presets that set them in one import in fab.md, rule values in rules.md.

```tsx
import PCB from '@pcbjs/core'

export default (
  <PCB name="Hello" rev="0.1.0">
    <rect layer="Edge.Cuts" x={0} y={0} w={30} h={20} />
  </PCB>
)
```

Lengths, positions and rotations must be finite after unit conversion; NaN, infinities and string overflow are rejected before geometry. Positions and rotations may be negative, and zero remains valid where the field permits it. Pad size and drill axes and via size and drill must each be strictly positive.

## `<PCB>`

The root, once per entry; `<board>` is the same. The module that default-exports it is an entry, listed in `entries` in pcb.config.ts. Names are free; editors and readers recognise `pcb.tsx` for one board and `<board>.pcb.tsx` beside `<board>.sch.tsx` for several.

A first board sets `name` and `rev` and nothing else: the fab preset it imports, fab.md, sets the stackup, rules and sourcing, and every other prop has a default.

| Prop | Default | Meaning |
| --- | --- | --- |
| `name` | required | file names, URLs and the viewer key |
| `title` | `name` | what the viewer shows |
| `rev` | `""` | the revision, in the fab zip name and README-fab |
| `stackup` | `twoLayer()`, 1.6 mm | every physical layer and so the copper count and thickness, stackup.md |
| `fonts` | none | outline fonts for `<text font>` by name, `{ Slab: { file: './fonts/RobotoSlab-Bold.ttf' } }`, see fonts.md |
| `rules` | `BASE` | partial rule set merged key by key, see rules.md |
| `autoroute` | `BASE_BOARD.autoroute` | partial parameters merged key by key, see route-options.md |
| `classes` | `{}` | net classes, `{ power: { width: 0.5 } }`, merged by class then field, see route-options.md |
| `strict` | false | a leg the router cannot route throws instead of a `route-failed` finding |
| `sourcing` | `[]` | ordered sourcing tags, see sourcing.md |
| `fabNotes` | none | lines for the Notes of README-fab, see fab-set.md |
| `teardrops` | off | `true` or `{ pads, length, width }`, see route-options.md |
| `silkRefs` | true | false drops every silk ref, see layout.md |
| `cpl` | `{ origin: 'footprint' }`, `'center'` for JLCPCB presets | where `cpl.csv` places a part, see fab-set.md |
| `refStyle` | `"flat"` | `"hierarchical"` names circuit parts `BUCK1_R1`, see circuits.md |
| `plugins` | none | compiler plugins after the config's, see plugins.md |
| `place` | `{ seed: 1 }` | the seed of the placer's search for parts with an `auto` slot in `at`, see placement.md |
| `patches` | none | `patch()` calls, before the inline ones and the `.patches.ts` file, see patches.md |
| `schematic` | drawn by the compiler | the schematic module as a namespace, `import * as sch`, whose exports are then in scope by name and whose `drawing` export is the drawing; see schematic-graphic.md |

A preset such as `@pcbjs/fab/JLCPCB/2-Layer` is a `<PCB>` with stackup, rules and sourcing set; it and `variants()` also take `color`, `silk` and `finish`, see fab.md.

## Units and coordinates

| What | Form |
| --- | --- |
| length | number in mm, or a string with `mm`, `cm`, `m`, `mil`, `in`, `um`, `nm`, lower case and right after the number: `"100mil"`, `"0.1in"`, `"1e-1mm"`; `"10 mm"` is an error |
| angle | a number of degrees, `"90deg"`, or `"1.57rad"` for a computed angle in radians; `rad` is only ever written, never inferred |
| grid position | under `<PCB grid>` or `<g grid>`, the bare numbers of a part's or group's `at` are pitches of the grid, see grids.md |
| `at` | the string `"x y"` or `"x y rot"`, separated by spaces; computed numbers go in a template string, `` at={`${x} ${y}`} ``; on a part a slot may be `auto`, see placement.md |
| frame | SVG's, seen from the top: x right, y down, origin where you put it |
| rotation | counter-clockwise on screen, as in KiCad |
| side | `F` or `B` |

- A `PinHeader(2)` at `at="10 10 90deg"` has pin 1 at (10, 10) and pin 2 at (12.54, 10): its +x side points up.
- `side="B"` mirrors about the local y axis first, then rotates. KiCad mirrors about local x, so a KiCad `B 0` is `side="B"` at 180deg here and `B -90` is 90deg; see kicad.md.
- A 2-row header on the back is mirrored too; check one that mates through the board with `pcbjs inspect`.
- The editor shows the unit a bare number gets after it, `at="9 7.5"` reading `9mm 7.5mm`, a rotation `90deg`, a grid position `3·⊞2.54mm`; an explicit unit gets none. A unit the compiler does not know is a compile error naming the value; editor.md has the hints.
- `<g>`, `<footprint>`, `<pad>` and `<text>` translate and rotate their content by `at`. `side="B"` on a group or footprint mirrors it and swaps every `F.*` layer with its `B.*` twin; two nested flips cancel.
- Gerber, drill and placement outputs flip y to point up.
- `pcbjs inspect <entry> <ref>` prints where pads ended up, see inspect.md.

## Layers

KiCad's ids, as written: `F.Cu`, `In1.Cu` to `In6.Cu`, `B.Cu`, `F.SilkS`, `B.SilkS`, `F.Mask`, `B.Mask`, `F.Paste`, `B.Paste`, `F.Fab`, `B.Fab`, `F.CrtYd`, `B.CrtYd`, `Edge.Cuts`, `Dwgs.User`, `Cmts.User`. A 4-layer board has In1 and In2, an 8-layer one In1 to In6. Code names layers by id only; the `--layer` flags of the CLI and the viewer URL also take `top`, `bottom`, `silk`, `edge` and the like, cli.md.

- `F.Cu` becomes `B.Cu` inside a `side="B"` parent, and every `F.*` id its `B.*` twin.
- Mask and paste come from pads: an `F.Mask` opening grown by `maskExpansion`, and for an SMD pad with `paste` an `F.Paste` shape shrunk by `pasteShrink`.
- The outline is every `Edge.Cuts` item chained into closed rings, 0.01 mm tolerance; a closed shape inside is a cutout.
