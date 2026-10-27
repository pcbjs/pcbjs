# Importing from KiCad

`pcbjs import footprint` and `pcbjs import board`, `kicadFootprint()` and `readFootprint()` of `@pcbjs/kicad`: what each imports, the conventions applied and what a person refines after a board import.
The frame, the back side and the Gerber differences between the two tools are in kicad.md.

## Commands

```sh
pcbjs import footprint <Lib:Name | file.kicad_mod> [-o lib/<name>.tsx] [--force]
pcbjs import board <file.kicad_pcb> [-o pcb.tsx] [--force]
```

- `import footprint` writes one `defineFootprint` module the project owns and edits: pads, graphics on every layer, text, keepouts, the courtyard and the model reference, with a header naming the source and its licence. `Lib:Name` is looked up as `kicadFootprint` does, below; a bare `Name` in every library.
- `import board` writes the board's files beside `-o`, replacing one only with `--force`. `pcb.config.ts` and `tsconfig.json` go to the nearest folder from `-o` up to the working folder with a `package.json`, else beside `-o` with a new one; `package.json` and `tsconfig.json` are never replaced, and an existing config is kept, the entry and rules to add printed. It reads the `.kicad_pro`, `.kicad_dru` and `.kicad_sch` of the same name when they are there.
- Both take KiCad 8 to 10 files, format 20240108 and newer, and most older ones.

## Library footprints in code

```tsx
import PCB, { nets } from '@pcbjs/core'
import { kicadFootprint } from '@pcbjs/kicad'

const SOIC8 = kicadFootprint('Package_SO:SOIC-8_3.9x4.9mm_P1.27mm', { pinNames: { 4: 'GND', 8: 'VCC' } })
const { IN, OUT, OUTB, GND, VCC } = nets()
const U1 = SOIC8('LM358').connect({ 1: OUT, 2: OUT, 3: IN, GND, 5: GND, 6: OUTB, 7: OUTB, VCC })

export default <PCB name="Amp"><rect layer="Edge.Cuts" x={0} y={0} w={20} h={15} /><U1 at="10 7.5" /></PCB>
```

- `kicadFootprint(ref, { pinNames, prefix, value, model, footprints, silk })` returns a factory used like the standard library's; `silk: 'none'` leaves out the footprint's silk, as stdlib.md has it. Its pins are the pad numbers in pad order, one pin per number; `pinNames` renames them by a list in pin order or a record keyed by pad number, and a pad named `NC` is no pin. The prefix comes from the library and name, `R_0603` is R, `SOIC` U.
- The reference is `Lib:Name`, a bare `Name`, or a path to a `.kicad_mod`. Libraries are searched in this order: the `.pretty` folders of the project root, `lib/`, `footprints/` and `lib/footprints/`; `kicad.footprints` in pcb.config.ts; `KICAD_FOOTPRINTS`, a path list; the installed KiCad library, from `KICAD10_FOOTPRINT_DIR` and its older names or the install folder.
- A file is read once per path and content; an edited `.kicad_mod` applies on the next compile.
- The model line resolves `${KICAD10_3DMODEL_DIR}`, `${KICAD9_3DMODEL_DIR}`, `${KICAD8_3DMODEL_DIR}` and the older names to the installed `3dmodels` folder, or `kicad.models` of the config, and `${KIPRJMOD}` to the project root, or in an import the folder of the `.kicad_pcb`, so the 3D view finds it without a copy. A `model` option is relative to the file calling `kicadFootprint`. A `.wrl` that is missing becomes the `.step` beside it. `pcbjs model add <file> --ref U1 --write` still copies it into `models/`.
- `readFootprint(textOrPath)` returns the definition itself: `defineFootprint(def.render, def.meta)` makes the factory, and `def.elements` lists the pads, graphics and text as data.

## What a footprint import carries

- Pads of every type: `smd`, `thru_hole`, `np_thru_hole` as `npth`, and `connect` as smd without paste. Shapes `circle`, `rect`, `oval` and `roundrect`, `roundrect_rratio` as `roundness`, map one to one. A trapezoid, a chamfered rectangle, a pad whose copper is offset from its hole, and a custom pad, its anchor and primitives joined, become `shape: 'custom'` with `points`, see layout.md.
- Drills, round and slotted; the pad's own rotation; its copper layers, a smd pad on `B.Cu` included; `solder_mask_margin` as `maskExpansion`; the pad's own `clearance` as its `clearance`, see rules.md Overrides, 0 meaning none as in KiCad 8; a negative `solder_paste_margin` as `pasteShrink` and `solder_paste_margin_ratio` as `pasteRatio`, a positive margin as a grown `paste` window; no `F.Paste` as `paste: false`; `zone_connect` 0 and 2 as `thermal: 'none'` and `'solid'`; `thermal_bridge_angle`, by default 45 on a round pad, as `thermal: { angle: 45 }`. Paste-only pads on a copper pad without paste of its own become its `paste` windows, so a hand-solder land pastes only where KiCad does.
- A padstack whose front shape differs from its inner and back shape is two pads of one number: the hole with the back shape on every layer, and the front shape on F.Cu. DRC treats pads of one footprint with one number as one pad.
- `fp_line`, `fp_arc`, `fp_circle`, `fp_rect`, `fp_poly` and `fp_curve` on copper, silk, mask, paste, Fab, courtyard, `Edge.Cuts` and the user layers, with their widths and fills. Lines and arcs of one layer and width are joined into one path, arcs as `A` commands that reach the Gerbers as arcs. Eco and `User.N` layers go to `Cmts.User`; adhesive and margin graphics are left out.
- User `fp_text` with its size, glyph width, thickness, justification and rotation. The reference and value are drawn by pcbjs, see layout.md, Silk refs; text with a `${…}` variable is left out.
- Keepout zones of a footprint as `keepout` elements; `exclude_from_bom` and `exclude_from_pos_files` as `bom` and `pos`; the first shown model with its offset, scale and rotation.
- `net_tie_pad_groups` as `netTie` on the footprint, so a Kelvin shunt's sense tabs touch its current pads without a short, see layout.md Pads.
- A board's pad pin functions and types become a comment beside the part's `.connect()`.

## What a board import writes

| File | Holds |
| --- | --- |
| `pcb.tsx` | `<PCB>` with the name, title, revision, the stackup and the net classes; the outline and cutouts as lines and arcs; every placement grouped by ref prefix; the text; then `copper` and `<Art />` |
| `pcb.sch.ts` | the nets, `nets()` keeping KiCad's names, `+5V` as `P5V` and `/D6` as `D6`; one part per footprint named by its ref, with value, `bom`, `pos`, `dnp` and each pin's net in `.connect()` |
| `pcb.sourcing.ts` | `source()` per set of equal fields: the footprints' fields with the `.kicad_sch` symbols' over them, MPN, Manufacturer, LCSC as `MPN:LCSC` and every field the project uses |
| `pcb.copper.tsx` | pours with net, layer, clearance, priority, minimum width and connection; keepouts; each net's tracks as `route()` chains of straight `.Z()` segments with `.neck(AS_DRAWN)`, `.via()` at a layer change and `.vias(VIA)` for the size; vias no chain passes through; track arcs as tracks with an `A` path |
| `pcb.art.tsx` | the board's own silk, Fab and user graphics |
| `lib/<Name>.tsx` | every footprint that is not the installed KiCad library's own, from the copy in the board, so local `.pretty` footprints and edited library ones keep the board's geometry; copies that differ only in element order, an outline's start, the courtyard, coordinates within 1 µm or pad zone connections make one module, from the copy with the tightest courtyard; a placement whose pads join pours otherwise gets a `thermal` map of them, `<C3 thermal={{ 2: 'solid' }} />` |
| `lib/kicad.ts` | `kicadFootprint()` for footprints whose pads, copper, mask, paste, silk and courtyard match the installed library |
| `pcb.config.ts` | the entry and `defineDefaultRules` from the `.kicad_pro` and the board setup; each `.kicad_dru` rule as a comment saying what it became |

- Refs are KiCad's; one like `R1` binds by its variable name; any other, such as `J_HR`, gets `.ref('J_HR')`.
- A chain starts and ends at a pin handle, `U1[3]`, where its end is a pad centre of a pin with one pad, and at a coordinate otherwise, with `.net()` when neither end is a pad.
- Pads on a net named `unconnected-(…)`, or on none, connect to `NC`.
- Every chain has `.neck(AS_DRAWN)`, `{ length: 0 }`, so pcbjs does not narrow KiCad's tracks at pads they are wider than, see routing.md; drop it on a chain you redo.
- `exclude_from_bom`, `exclude_from_pos_files` and DNP, of board or symbol, are the part's `bom`, `pos` and `dnp`, or the placement's for a plain footprint.
- A through-hole pad with `remove_unused_layers` lists in `layers` the copper layers a track or zone joins it on in any placement, and the outer layers with `keep_end_layers`.
- Filled silk is written before the items of its layer inside it, so it never clears a glyph.
- Custom rules of the `.kicad_dru` with one `(min …)` constraint of `clearance`, `hole_clearance`, `edge_clearance` or `track_width` map onto overrides, see rules.md Overrides:
  - one footprint, `A.Parent == 'J1'` or `A.Reference == 'J1'`, B the same or nothing, `A.Type == 'Pad'` allowed: `.rules({ … })` on that part, one per alternative;
  - `A.NetClass == 'X'`, B the same or nothing: the clearance of class X;
  - every pair of one list of nets, `(A.NetName == 'P' || …) && (B.NetName == 'P' || …)`: a class of them named after the rule, unless one has a class;
  - a pad of a `Pad_Type`, a footprint or any, against a `B.Type`: a part clearance by kind, `{ track: 0.4 }`, on every such part, unless one has pads of another type too;
  - a `Track` or `Via` of one `NetName` or `NetClass` against a `B.Type`: a clearance by kind on that net, `.rules()`, or class; a `NetName`, `!=` or other term on B is dropped, a stricter rule, as the comment says.
  - `B.Type == 'Pad' && B.Pad_Type == 'Through-hole'` or `'SMD'` on the other side of either form scopes the clearance toward pads by type, `{ pad: { tht: 0.5 } }`; an `'NPTH, mechanical'` term is dropped.
  - Any other rule, such as a courtyard rule or one between two footprints, stays a comment in `pcb.config.ts` and a note.
- A footprint's own `clearance` becomes `.rules({ clearance })` on its part, or `rules` on a plain footprint; a custom rule on the same part merges, the larger per kind.
- Rules: `clearance` is the larger of KiCad's minimum and the Default class; track width, edge and hole clearance, drills, annular rings, hole to hole and `maskExpansion` map one to one; `silkMinWidth` is the thinnest silk text or line, as KiCad checks text only; `thermal` takes the most common zone relief and KiCad's minimum spokes.

## Conventions applied

The frame, back side and text conventions an import applies are in kicad.md, Import conventions.

## Not imported

- `.kicad_dru` rules that map onto no override; thermal gap and spoke width per pad or zone; the board's positive or ratio paste clearance. The notes and pcb.config.ts list them.
- Mask-only pads, `duplicate_pad_numbers_are_jumpers`, dimensions, images, groups, text boxes, tables and copper graphics' nets. Zone fills are recomputed.
- A padstack with a third, inner shape takes its back shape on the inner layers.

## After a board import

1. `pcbjs check --fab`. What remains are KiCad rules pcbjs does not carry, named in the notes, pairs where KiCad lowered one item's clearance but the other keeps the larger, or checks KiCad lacks, such as silk width on lines; settle each by a rule, a net class or a design change.
2. Rename the pins of the footprints you will connect by name, with `pinNames` on `kicadFootprint` or `name` on the pads of a `lib/` module, then `.connect()` by name.
3. Replace routes you want redone with `.X()` legs, and `.lock()` the ones to keep, see routing.md.
4. Swap `lib/` footprints for standard library families where one fits, see stdlib.md.
5. Move the stackup and rules to a fab preset such as `@pcbjs/fab/JLCPCB/4-Layer` when the board is ordered there, see fab.md.
