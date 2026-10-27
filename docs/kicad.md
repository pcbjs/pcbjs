# Coming from KiCad

What carries over from KiCad one to one and what does not: the frame, the back side, refs, text, pads in the Gerbers, models and silk.
Read it before porting a KiCad board or footprint; import.md has the importer.

## The frame

- Millimetres, x right, y down, as KiCad's board and footprint editors. A coordinate copied from a `.kicad_pcb` or `.kicad_mod` lands at the same place, so `at="9 -5"` here is KiCad's `(at 9 -5)`.
- Rotation is counter-clockwise on screen in both: a front part at KiCad `(at 13.3 5 180)` is `at="13.3 5 180deg"`.
- A footprint's origin is where its own coordinates put it. A footprint retyped from a `.kicad_mod` keeps KiCad's origin. The standard library is centred on the body for most families and on pin 1 for headers and sockets, see stdlib.md, so a KiCad placement of a JST footprint moves by the offset between the two origins.
- `pcbjs inspect J1` prints every pad's board centre and its size in board axes, x across and y down the screen, as KiCad plots it. `--json` keeps the footprint axes in `footprintSize`. Compare a port against KiCad with it, never by hand.

## The back side

KiCad flips a back part about its local x axis, top to bottom. pcbjs mirrors it about its local y axis, left to right, then rotates it. The two differ by a half turn, so a KiCad back placement at angle `a` is `side="B"` at `a + 180` here:

| KiCad | pcbjs |
| --- | --- |
| `(layer "B.Cu") (at 0 0)` | `at="0 0 180deg" side="B"` |
| `(layer "B.Cu") (at 9 -5 -90)` | `at="9 -5 90deg" side="B"` |
| `(layer "B.Cu") (at x y 90)` | `at="x y 270deg" side="B"` |

Front parts need nothing. Back text follows the part and reads mirrored from the front in both tools.

## Refs

Parts are numbered by prefix when the board compiles, see schematic.md. To keep the refs of a KiCad project, pin each with `.ref()`: letters, digits and underscores, starting with a letter, so `J_HR` is fine. A plain footprint with no pins, such as a mounting hole, takes `ref` where it is placed:

```tsx
import { JST_PH, MountingHole } from '@pcbjs/lib'

const J2 = JST_PH(6, 'side', { drill: 0.8 }).ref('J_PH')
const Hole = MountingHole(3.2)
// <J2 at="9 -5 90deg" side="B" />  <Hole ref="H1" at="3.5 3.5" />
```

## Text

- pcbjs strokes `<text>` in Hershey Simplex by default. `font="newstroke"` is KiCad's own stroke font, the same glyphs KiCad draws, and what `pcbjs import` writes for KiCad's stroke text. `size` is the cap height in both, KiCad's text height.
- KiCad's `(size h w)` and `(thickness t)` map to `size={h}`, `width={w}` and `thickness={t}`. `width` stretches each glyph and its advance across the baseline and defaults to `size`, so KiCad's 1.25 mm high, 1.35 mm wide numbers are `size={1.25} width={1.35}`.
- `at` is the middle of the text by default, as KiCad's centred justification: `anchor` sets the horizontal end, and the vertical centre runs from the cap line to the baseline.
- On silk, `thickness` is never thinner than the board's `silkMinWidth`, 0.15 mm by default.

## Pads in the Gerbers

- Round copper pads and vias are flashed with a circle aperture, as KiCad does. Every other pad, and every mask opening, is written as a G36 region, a filled polygon, where KiCad flashes `R`, `O` and `RoundRect` apertures. The copper is the same up to the polygon's chords on curved edges, a thin rim on an oval.
- Mask openings grow every pad by the `maskExpansion` rule, 0.05 mm by default. KiCad's pad to mask clearance maps to it, such as a 0.0762 mm, 3 mil, clearance.
- Arcs on Edge.Cuts and silk stay arcs, G02 and G03, as in KiCad's export.

## Models

- A `.kicad_mod` `(model ...)` line maps one to one: `(offset (xyz 10 0 0)) (scale (xyz -1 1 1)) (rotate (xyz 0 0 0))` is `model: { file, offset: [10, 0, 0], scale: [-1, 1, 1], rotate: [0, 0, 0] }`, with the same order of scale, rotate and offset.
- KiCad's `${KICAD10_3DMODEL_DIR}/...` path, or an older `KICAD9` or `KICAD8` one, works as it is through `kicadModel('${KICAD10_3DMODEL_DIR}/…')` of `@pcbjs/kicad`, which resolves it to the installed `3dmodels` folder; an imported footprint writes it so. To own the file, `pcbjs model add` copies it into `models/`; the path is then relative to the file that defines the footprint, so a footprint in `lib/footprints.tsx` writes `../models/...` even when `pcb.tsx` places it. 3d.md has the rules.
- `${KIPRJMOD}` is the project root: the folder of pcb.config.ts for `kicadFootprint`, the folder of the `.kicad_pcb` in an import, never the library folder. Any other relative model path, a `model` option of `kicadFootprint` included, is relative to the file that writes it.
- A KiCad library model fits a standard library part with no transform where the origins agree, the passives, `PinHeader` and `USBC`; a centred family such as JST needs the origin offset.

## Silk and the mask

pcbjs clears silk from the mask openings in the Gerbers, as KiCad's `--subtract-soldermask` does, and the `silk-over-pad` warning marks each stroke that runs into an opening, so the design can be fixed rather than the fab file. The standard library's silk outlines are already broken around their pads. KiCad checks the thickness of silk text only; pcbjs checks every silk stroke against `silkMinWidth`, so the importer sets it to the thinnest silk the board draws. A KiCad NoSilkScreen footprint is the standard library family with `silk: 'none'`, `JST_PH(6, 'side', { silk: 'none' })`; a side entry's default silk leaves its mating face open, so it may sit flush with the edge, see stdlib.md.

## Gerbers against KiCad's

The importer's tests compare a pcbjs fab set with the one kicad-cli writes for the same board, two KiCad boards in `packages/kicad/tests/fixtures/boards`: `small`, library footprints of every pad shape on both sides with vias, an arc track, a pour and an outline arc, and `tabs`, slotted pads, a back part, an arc track, a `.kicad_dru` and a `.kicad_sch`. Copper, mask, paste and outline match KiCad's by bounding box to 2 µm and the drill files hole for hole, slots included.

Every pad lands at KiCad's position, with the half turn added on each back part. pcbjs also writes empty paste layers for a board with no SMD pads, which KiCad leaves out.

## Import conventions


- A board footprint returns to its own frame: KiCad stores pad and text angles absolute, a back part's children flipped and footprint zones in board coordinates.
- A back part is placed `side="B"` at KiCad's angle plus 180, as kicad.md explains, and its footprint is written front side up, so one module serves both sides.
- Text keeps its anchor: left and right justification become `anchor`, and `at` moves to pcbjs's vertical centre. Back text is mirrored by its layer.
- KiCad's stroke text is `font="newstroke"`, KiCad's own font, at KiCad's size, width and thickness, `at` moved as KiCad places its first baseline, `kicadStrokeShift` of `@pcbjs/kicad`; the ink lands on KiCad's, fonts.md.
- Board text in a TrueType face is drawn in the installed font, copied to `fonts/` with its licence in `fonts/LICENSES.md` and sized as KiCad draws it, fonts.md; a face not installed is drawn in Hershey.

## Importing

`pcbjs import footprint <Lib:Name>` writes a footprint as a `defineFootprint` module, `kicadFootprint('Lib:Name')` uses one from the installed KiCad library in code, and `pcbjs import board <file.kicad_pcb>` writes a whole board as a skeleton to refine. import.md has what each carries and what it leaves out.

Libraries other than the installed one are listed in pcb.config.ts, folders of `.pretty` folders or `.pretty` folders themselves, relative to the config:

```ts
import { defineConfig } from '@pcbjs/core'

export default defineConfig({
  entries: ['pcb.tsx'],
  kicad: { footprints: ['../lib/footprints'] },  // searched before KICAD_FOOTPRINTS and the installed library
})
```

`kicad.models` names the folder `${KICAD10_3DMODEL_DIR}` stands for when it is not the installed one.

Seven scripted KiCad boards were imported and checked with `pcbjs check --fab`: the Gerber self check passes on all, drill files match KiCad's hole for hole and copper outside pours to 0.02 mm, and the findings left are `.kicad_dru` rules and per-pad clearances pcbjs rules do not carry. Pours differ by a few percent of their area: pcbjs draws its own reliefs, and both remove islands, see pours.md Islands.
