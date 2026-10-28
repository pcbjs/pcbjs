# Importing from KiCad

`pcbjs import footprint` and `pcbjs import board`, `kicadFootprint()` and `readFootprint()` of `@pcbjs/kicad`: what each imports, the conventions applied and what a person refines after a board import.
The frame, the back side and the Gerber differences between the two tools are in kicad.md.

```sh
pcbjs import footprint <Lib:Name | file.kicad_mod> [-o lib/<name>.tsx] [--force]
pcbjs import board <file.kicad_pcb> [-o pcb.tsx] [--force]
```

- `import footprint` writes one `defineFootprint` module to edit: pads, graphics on every layer, text, keepouts, courtyard, model, a header with source and licence. `Lib:Name` is looked up as `kicadFootprint` does, a bare `Name` in every library.
- `import board` writes beside `-o`, replacing only with `--force`, and reads the `.kicad_pro`, `.kicad_dru` and `.kicad_sch` of the same name.
- `pcb.config.ts` and `tsconfig.json` go to the nearest folder up from `-o` with a `package.json`, else beside `-o` with a new one. `package.json` and `tsconfig.json` are never replaced; for an existing config the entry and rules to add are printed.
- Conventions applied: kicad.md, Import conventions. Both read KiCad 8 to 10, format 20240108 and newer, and most older files.

## Library footprints in code

```tsx
import PCB, { nets } from '@pcbjs/core'
import { kicadFootprint } from '@pcbjs/kicad'

const SOIC8 = kicadFootprint('Package_SO:SOIC-8_3.9x4.9mm_P1.27mm', { pinNames: { 4: 'GND', 8: 'VCC' } })
const { IN, OUT, OUTB, GND, VCC } = nets()
const U1 = SOIC8('LM358').connect({ 1: OUT, 2: OUT, 3: IN, GND, 5: GND, 6: OUTB, 7: OUTB, VCC })

export default <PCB name="Amp"><rect layer="Edge.Cuts" x={0} y={0} w={20} h={15} /><U1 at="10 7.5" /></PCB>
```

| Option | Does |
| --- | --- |
| `pinNames` | a list in pin order or a record by pad number; default one pin per pad number in pad order; a pad named `NC` is no pin |
| `prefix` | ref prefix, by default from library and name: `R_0603` is R, `SOIC` U |
| `value` | default value, the footprint name |
| `model` | model over the footprint's, relative to the calling file; `false` for none |
| `footprints` | extra library roots, searched first |
| `silk` | `'none'` leaves out the silk |

- The reference is `Lib:Name`, a bare `Name` or a `.kicad_mod` path, searched in: `.pretty` folders in the project root, `lib/`, `footprints/` and `lib/footprints/`; `kicad.footprints` of pcb.config.ts; `KICAD_FOOTPRINTS`, a path list; the installed library from `KICAD10_FOOTPRINT_DIR`, its older names or the install folder. Read once per path and content.
- `${KICAD10_3DMODEL_DIR}`, `${KICAD9_3DMODEL_DIR}`, `${KICAD8_3DMODEL_DIR}` and older names resolve to the installed `3dmodels` or `kicad.models`, `${KIPRJMOD}` to the project root or the `.kicad_pcb` folder in an import. A missing `.wrl` becomes the `.step` beside it; `pcbjs model add <file> --ref U1 --write` copies one into `models/`.
- `readFootprint(textOrPath)` returns the definition: `defineFootprint(def.render, def.meta)` makes the factory, `def.elements` is pads, graphics and text as data.

## What a footprint import carries

| KiCad | pcbjs |
| --- | --- |
| `smd`, `thru_hole`, `np_thru_hole`, `connect` | smd, a drilled pad, `npth`, smd without paste |
| `circle`, `rect`, `oval`, `roundrect` | the same; `roundrect_rratio` as `roundness` |
| trapezoid, chamfered rect, copper offset from hole, custom | `shape: 'custom'` with `points` |
| drills round and slotted, pad rotation, copper layers, smd on `B.Cu` | the same |
| `solder_mask_margin` | `maskExpansion` |
| pad `clearance`, 0 meaning none | its `clearance` |
| negative `solder_paste_margin`, `solder_paste_margin_ratio` | `pasteShrink`, `pasteRatio`; a positive margin a grown `paste` window |
| no `F.Paste` | `paste: false` |
| `zone_connect` 0 and 2 | `thermal: 'none'` and `'solid'` |
| `thermal_bridge_angle`, default 45 on round pads | `thermal: { angle: 45 }` |
| paste-only pads on a pasteless copper pad | its `paste` windows |
| padstack, front shape unlike back | two pads of one number, the hole with the back shape, the front on F.Cu; DRC treats them as one |
| `fp_line`, `fp_arc`, `fp_circle`, `fp_rect`, `fp_poly`, `fp_curve` | on every layer with widths and fills; lines and arcs of one layer and width join into one path, arcs as `A` |
| Eco and `User.N` layers | `Cmts.User`; adhesive and margin graphics left out |
| user `fp_text` | size, glyph width, thickness, justification, rotation; `${…}` text left out; ref and value drawn by pcbjs |
| keepout zones | `keepout` elements |
| `exclude_from_bom`, `exclude_from_pos_files` | `bom`, `pos` |
| first shown model | with offset, scale, rotation |
| `net_tie_pad_groups` | `netTie` |
| a board pad's pin function and type | a comment beside `.connect()` |

## What a board import writes

| File | Holds |
| --- | --- |
| `pcb.tsx` | `<PCB>` with name, title, revision, stackup and net classes; outline and cutouts as lines and arcs; placements grouped by ref prefix; text; then `copper` and `<Art />` |
| `pcb.sch.ts` | `nets()` with KiCad's names, `+5V` as `P5V`, `/D6` as `D6`; a part per footprint named by ref with value, `bom`, `pos`, `dnp` and each pin's net in `.connect()` |
| `pcb.sourcing.ts` | `source()` per set of equal fields, `.kicad_sch` symbols' over footprints': MPN, Manufacturer, LCSC as `MPN:LCSC`, every field used |
| `pcb.copper.tsx` | pours with net, layer, clearance, priority, minimum width, connection; keepouts; tracks as `route()` chains of `.Z()` with `.neck(AS_DRAWN)`, `.via()` at a layer change, `.vias(VIA)` for size; free vias; arcs as `A` paths |
| `pcb.art.tsx` | the board's silk, Fab and user graphics |
| `lib/<Name>.tsx` | each footprint not the installed library's, from the board's copy; copies differing only in element order, outline start, courtyard, coordinates within 1 µm or pad zone connections merge with the tightest courtyard; a placement whose pads join pours otherwise gets `<C3 thermal={{ 2: 'solid' }} />` |
| `lib/kicad.ts` | `kicadFootprint()` for footprints matching the installed library in pads, copper, mask, paste, silk and courtyard |
| `pcb.config.ts` | the entry, `defineDefaultRules` from `.kicad_pro` and board setup, each `.kicad_dru` rule as a comment saying what it became |

- Refs stay KiCad's: `R1` binds by variable name, `J_HR` gets `.ref('J_HR')`.
- A chain ends at a pin handle, `U1[3]`, on the pad centre of a one-pad pin, else at a coordinate, with `.net()` when neither end is a pad.
- Pads on none or on `unconnected-(…)` connect to `NC`.
- `.neck(AS_DRAWN)` is `{ length: 0 }`, so wide tracks are not narrowed at pads; drop it on a chain you redo.
- DNP of board or symbol is `dnp`, on the part or a plain footprint's placement.
- A through-hole pad with `remove_unused_layers` lists in `layers` the copper a track or zone joins it on, plus the outer layers with `keep_end_layers`.
- Filled silk goes before the items of its layer inside it, so it never clears a glyph.

### `.kicad_dru` rules

A rule with one `(min …)` of `clearance`, `hole_clearance`, `edge_clearance` or `track_width` becomes an override:

| Condition | Becomes |
| --- | --- |
| one footprint, `A.Parent == 'J1'` or `A.Reference == 'J1'`, B the same or none, `A.Type == 'Pad'` allowed | `.rules({ … })` on the part, one per alternative |
| `A.NetClass == 'X'`, B the same or none | class X's clearance |
| `(A.NetName == 'P' \|\| …) && (B.NetName == 'P' \|\| …)` | a class named after the rule, unless a net has one |
| a pad of a `Pad_Type`, footprint or any, against a `B.Type` | `{ track: 0.4 }` on each such part, unless it has pads of another type |
| a `Track` or `Via` of one `NetName` or `NetClass` against a `B.Type` | clearance by kind on the net or class; a `NetName`, `!=` or other B term dropped, stricter, as the comment says |
| `B.Type == 'Pad' && B.Pad_Type == 'Through-hole'` or `'SMD'` | `{ pad: { tht: 0.5 } }`; `'NPTH, mechanical'` dropped |
| anything else, a courtyard or footprint pair rule | a comment in `pcb.config.ts` and a note |

- A footprint's own `clearance` is `.rules({ clearance })`, or `rules` on a plain footprint; a custom rule on the same part merges, larger per kind.
- `clearance` is the larger of KiCad's minimum and the Default class. Track width, edge and hole clearance, drills, annular rings, hole to hole and `maskExpansion` map one to one. `silkMinWidth` is the thinnest silk text or line. `thermal` takes the most common relief and KiCad's minimum spokes.

## Not imported

- `.kicad_dru` rules with no override, per-pad or zone thermal gap and spoke width, positive or ratio board paste clearance; the notes and pcb.config.ts list them.
- Mask-only pads, `duplicate_pad_numbers_are_jumpers`, dimensions, images, groups, text boxes, tables, copper graphics' nets. Fills are recomputed.
- A third, inner padstack shape takes the back shape.

## After a board import

1. `pcbjs check --fab`; settle what remains, unsupported rules from the notes, clearances KiCad lowered for one side, checks KiCad lacks such as silk line width, by a rule, net class or design change.
2. Rename pins with `pinNames` or `name` on `lib/` pads, then `.connect()` by name.
3. Turn routes to redo into `.X()` legs and `.lock()` the rest.
4. Swap `lib/` footprints for stdlib families.
5. Move stackup and rules to a fab preset such as `@pcbjs/fab/JLCPCB/4-Layer`.
