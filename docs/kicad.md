# Coming from KiCad

What carries over from KiCad one to one and what does not: the frame, the back side, refs, text, pads in the Gerbers, models and silk.
Read it before porting a KiCad board or footprint; import.md has the importer.

```tsx
import { JST_PH, MountingHole } from '@pcbjs/lib'

const J2 = JST_PH(6, 'side', { drill: 0.8 }).ref('J_PH')   // keep KiCad's ref
const Hole = MountingHole(3.2)
// KiCad (layer "B.Cu") (at 9 -5 -90) is  <J2 at="9 -5 90deg" side="B" />
// a plain footprint takes ref where placed: <Hole ref="H1" at="3.5 3.5" />
```

## The frame

- Millimetres, x right, y down, counter-clockwise rotation, as KiCad: `(at 13.3 5 180)` is `at="13.3 5 180deg"`.
- A footprint retyped from a `.kicad_mod` keeps KiCad's origin. The stdlib centres most families on the body, headers and sockets on pin 1, so a KiCad JST placement moves by the offset.
- Compare a port with `pcbjs inspect J1`: pad centres and sizes in board axes as KiCad plots them; `--json` keeps footprint axes in `footprintSize`.

## The back side

KiCad flips a back part top to bottom, pcbjs mirrors it left to right then rotates: add a half turn.

| KiCad | pcbjs |
| --- | --- |
| `(layer "B.Cu") (at 0 0)` | `at="0 0 180deg" side="B"` |
| `(layer "B.Cu") (at 9 -5 -90)` | `at="9 -5 90deg" side="B"` |
| `(layer "B.Cu") (at x y 90)` | `at="x y 270deg" side="B"` |

Back text follows the part and reads mirrored from the front in both.

## Refs

Parts are numbered by prefix at compile; `.ref()` pins one: letters, digits and underscores from a letter, `J_HR`.

## Text

| KiCad | pcbjs |
| --- | --- |
| stroke font | `font="newstroke"`, what `pcbjs import` writes; Hershey Simplex is the default |
| `(size h w)` | `size={h}` cap height, `width={w}` glyph width and advance, default `size` |
| `(thickness t)` | `thickness={t}`, on silk never under `silkMinWidth`, 0.15 mm by default |
| centred justification | `at` is the middle; `anchor` sets the horizontal end; vertical centre is cap line to baseline |

## Pads in the Gerbers

- Round pads and vias flash a circle, as KiCad. Other pads and every mask opening are G36 regions where KiCad flashes `R`, `O` and `RoundRect`: the same copper up to chords.
- Mask openings grow by `maskExpansion`, 0.05 mm by default; KiCad's pad to mask clearance maps to it, such as 0.0762 mm, 3 mil.
- Arcs on Edge.Cuts and silk stay G02 and G03.

## Models

- `(offset (xyz 10 0 0)) (scale (xyz -1 1 1)) (rotate (xyz 0 0 0))` is `model: { file, offset: [10, 0, 0], scale: [-1, 1, 1], rotate: [0, 0, 0] }`, same order.
- `kicadModel('${KICAD10_3DMODEL_DIR}/…')` of `@pcbjs/kicad` resolves that path, or `KICAD9` or `KICAD8`, to the installed `3dmodels`, as an import writes it. `pcbjs model add` copies the file into `models/`, then relative to the footprint's file, `../models/...` from `lib/footprints.tsx`.
- `${KIPRJMOD}` is the project root: the folder of pcb.config.ts for `kicadFootprint`, of the `.kicad_pcb` in an import. Any other relative path, a `kicadFootprint` `model` option included, is relative to the file that writes it.
- A KiCad model fits a stdlib part untransformed where origins agree: passives, `PinHeader`, `USBC`; centred JST needs the offset.

## Silk and the mask

- Silk is cleared from mask openings in the Gerbers, as `--subtract-soldermask`, and `silk-over-pad` warns per stroke. Stdlib silk is already broken around pads.
- Every silk stroke is checked against `silkMinWidth`, KiCad checks only text, so the importer sets it to the thinnest silk drawn.
- KiCad's NoSilkScreen footprint is `silk: 'none'`, `JST_PH(6, 'side', { silk: 'none' })`; a side entry's default leaves the mating face open.

## Gerbers against KiCad's

Tested against kicad-cli on `packages/kicad/tests/fixtures/boards`: `small`, every pad shape on both sides, vias, arc track, pour, outline arc; `tabs`, slotted pads, a back part, a `.kicad_dru` and a `.kicad_sch`. Copper, mask, paste and outline match by bounding box to 2 µm, drills hole for hole, slots included; KiCad writes no empty paste layer, pcbjs does.

## Import conventions

- A footprint returns to its own frame: KiCad stores pad and text angles absolute, back children flipped and footprint zones in board coordinates. It is written front side up, so one module serves both sides; a back part is `side="B"` at KiCad's angle plus 180.
- Left and right justification become `anchor`, `at` moved to the vertical centre; back text is mirrored by its layer.
- Stroke text is `font="newstroke"` at KiCad's size, width and thickness, `at` moved by `kicadStrokeShift` of `@pcbjs/kicad` so the ink lands on KiCad's.
- TrueType text uses the installed font, copied to `fonts/` with its licence in `fonts/LICENSES.md`, sized as KiCad; a missing face draws in Hershey.

## Importing

`pcbjs import footprint <Lib:Name>` writes a `defineFootprint` module, `kicadFootprint('Lib:Name')` reads the installed library in code, `pcbjs import board <file.kicad_pcb>` writes a skeleton. Other libraries go in the config:

```ts
import { defineConfig } from '@pcbjs/core'

export default defineConfig({
  entries: ['pcb.tsx'],
  kicad: { footprints: ['../lib/footprints'] },  // searched before KICAD_FOOTPRINTS and the installed library
})
```

Each is a `.pretty` folder or a folder of them, relative to the config. `kicad.models` names the folder `${KICAD10_3DMODEL_DIR}` stands for when not the installed one.

Seven scripted KiCad boards pass `pcbjs check --fab`: drills hole for hole, copper outside pours to 0.02 mm; `.kicad_dru` rules and per-pad clearances pcbjs does not carry remain. Pours differ by a few percent of area, since pcbjs draws its own reliefs.
