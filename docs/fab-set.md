# Fab set

Every file `pcbjs build` writes for the fab: Gerbers, drills, the order package, README-fab, BOM and placement, the `.pcb.svg` and `.sch.svg` documents, reproducible dates and the Gerber self check.
Presets, `bindPCB` and variants, which decide what goes into the set, are in fab.md.

One set per board in `<fabDir>/<name>/`, by default `.pcbjs/fab/<name>/`:

```
Blinky-F_Cu.gtl  -In1_Cu.g1 to -In6_Cu.g6  -B_Cu.gbl    copper, one file per layer
Blinky-F_Mask.gts  -B_Mask.gbs  -F_Paste.gtp  -B_Paste.gbp  -F_SilkS.gto  -B_SilkS.gbo
Blinky-Edge_Cuts.gm1     outline
Blinky-job.gbrjob        Gerber X2 job file with the stackup
Blinky-PTH.drl  -NPTH.drl             holes, each when there are any
Blinky-PTH-drl_map.svg   drill map per drill file
Blinky-drill-report.txt  every tool of every drill file
Blinky.ipc               IPC-D-356A netlist for electrical test
bom.csv  cpl.csv         bill of materials, placement in JLCPCB columns
Blinky.pcb.svg           the board as one SVG document
Blinky.sch.svg           the schematic, schematic-graphic.md
README-fab.txt           status and summary
manifest.json            every other file with size and sha256
Blinky-fab-0.1.0.zip     all of the above
```

## Gerbers

- Zip `<name>-fab-<revision>.zip`, or `<name>-fab-dev.zip` without a revision. A failed entry leaves its last set with a `STALE` file.
- X2, mm, y up. Non-circular pads are regions; stroke text a round aperture as wide as its thickness.
- Circular arcs stay arcs: `A` commands with equal radii, `<circle>`, `<rect rx>` corners, `roundedRect`, `circle`, `slot`; `G75*` once per layer, then `G02*` clockwise from the top or `G03*`, `I` and `J` from start to centre. Beziers, elliptical arcs and zone fills are segments.
- Silk is cleared from the same side's mask openings as KiCad's `--subtract-soldermask`: each opening a clear region after the legend.
- A fill with holes is an outer region then clear holes, outer before any pour inside, at any depth; a filled path with holes, the ring of a ©, is one dark region with a cut line into each hole.
- An empty paste layer is not written and README-fab says so. A pad's own `pasteRatio`, `pasteShrink` or `paste` windows print as given.
- Fab, courtyard and user layers are not exported. The job file has layer count, thickness, finish and a `MaterialStackup` per layer.

## Order package

| File | Holds |
| --- | --- |
| `<name>.ipc` | IPC-D-356A, `UNITS CUST 1`, 0.001 mm, y up; per pad and via: `317` plated hole, `327` surface pad, `367` non-plated hole; net, `N/C` for none, `NNAME<n>` past 14 characters; ref, `VIA`, pad; drill with `P` or `U`; access `A00` through, `A01` top, the copper count bottom; centre, size, rotation; mask `S0` covered to `S3` open both sides |
| `<name>-drill-report.txt` | each drill file, its layer span and every tool: diameter, holes, vias, slots |
| `<name>-PTH-drl_map.svg`, `-NPTH-` | outline and holes at size, one symbol per tool, legend of symbol, diameter, count |
| `manifest.json` | board, revision, target, generator, date, every other file with size and sha256; in the zip |

The generator, `pcbjs <version>` of @pcbjs/export, is also in the Gerber `TF.GenerationSoftware`, the job file and README-fab's `Generated` line.

## Reproducible dates

```sh
SOURCE_DATE_EPOCH=$(git log -1 --format=%ct) pcbjs build    # or pcbjs build --date <iso>; else now
```

Every dated file and zip entry gets that date, so two builds of one tree are byte identical in any time zone.

## Gerber self check

`pcbjs build` and `pcbjs check --fab` read the copper Gerbers and outline back; each difference is a DRC error `fab-mismatch`, else README-fab says `Gerber self check: passed`. `pcbjs check` without `--fab` and `pcbjs dev` skip it.

- each copper layer against the board's pads, tracks, vias, fills, graphics and text: symmetric difference above 0.01 mm², after dropping slivers under 12 µm from arc chords;
- copper outside the `Edge.Cuts` outline or inside a cutout;
- the outline against the board's;
- pads joined through copper and plated holes stay joined, pads of two nets apart.

## README-fab.txt

`STATUS: ORDERABLE`, or `STATUS: NOT ORDERABLE` with error counts; then size and counts, a `3D models` line per 3d.md, sourcing, stackup, every rule value, hole sizes, DRC and ERC findings as `pcbjs check` prints them, the self check, the files and notes. A target's second line names it, its fab and place.

- `fabNotes={['Single board, no panel.', 'Remove the order number.']}` opens the Notes; `<PCB>`, a preset, a target and `defineDefaultBoard` take it, joined defaults, preset or target, `<PCB>`, each line once.
- The Notes name each font: Hershey Simplex and NewStroke with provenance from fonts.md, an outline font with its copyright and licence.

## BOM and placement

| File | Columns |
| --- | --- |
| `bom.csv` | `Refs`, `Value`, `Footprint`, `Qty`, `MPN` for the board's tags, `Source` the tag matched or `MPN`, `Manufacturer`, `Datasheet`; then other fields, each `MPN:<tag>`, and `MPN:*` when a tag replaced the catch-all |
| `cpl.csv` | `Designator`, `Val`, `Package`, `Mid X`, `Mid Y`, `Rotation`, `Layer`, y up; footprints with both `pos` and `bom` |

- The BOM groups equal value, footprint id and fields, and skips `bom={false}`.
- `dnp` parts stay on the board and in DRC, out of both files; README-fab names them.
- `cpl={{ origin }}` on board or preset: `'center'`, the courtyard centre else the pads' extent, JLCPCB's default; or `'footprint'`, the footprint origin, pin 1 for a header, every other default. README-fab says which.

## The .pcb.svg document

Valid SVG with the board data in the `pcb:` namespace `https://pcb.svg/ns/1`, mm, y down.

- `<metadata>`: `pcb:board`, `pcb:rules` after defaults, `pcb:nets`, `pcb:footprints` with absolute positions, `pcb:drc` with counts.
- One `<g pcb:layer="…">` per layer, back to front; elements carry `data-id`, `data-kind` of `pad`, `track`, `via`, `zone`, `graphic` or `text`, and `data-net`, `data-ref`, `data-pad`.
- Holes last in the background colour; text a stroked path with its string in `pcb:text`; arcs as `A`.
- `boardSvg(board, { vars: true })` of `@pcbjs/export/svg` makes each colour a CSS variable with the default as fallback: `--pcb-<layer>` with `.` as `_`, `--pcb-F_Cu`, on a class per layer group, `--pcb-canvas` behind the board and in holes, `--pcb-substrate` inside the outline.
