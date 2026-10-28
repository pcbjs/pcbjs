# Fab set

Every file `pcbjs build` writes for the fab: Gerbers, drills, the order package, README-fab, BOM and placement, the `.pcb.svg` and `.sch.svg` documents, reproducible dates and the Gerber self check.
Presets, `bindPCB` and variants, which decide what goes into the set, are in fab.md.

## The fab set

`pcbjs build` writes one set per board to `<fabDir>/<name>/`, by default `.pcbjs/fab/<name>/`:

```
Blinky-F_Cu.gtl         front copper
Blinky-In1_Cu.g1        inner copper, one file per inner layer up to In6_Cu.g6
Blinky-B_Cu.gbl         back copper
Blinky-F_Mask.gts       front mask         Blinky-B_Mask.gbs   back mask
Blinky-F_Paste.gtp      front paste        Blinky-B_Paste.gbp  back paste
Blinky-F_SilkS.gto      front silkscreen   Blinky-B_SilkS.gbo  back silkscreen
Blinky-Edge_Cuts.gm1    board outline
Blinky-job.gbrjob       Gerber X2 job file with the stackup
Blinky-PTH.drl          plated holes, when there are any
Blinky-NPTH.drl         non-plated holes, when there are any
Blinky-PTH-drl_map.svg  drill map, one per drill file
Blinky-drill-report.txt every tool of every drill file
Blinky.ipc              IPC-D-356A netlist for electrical test
bom.csv                 bill of materials
cpl.csv                 placement, JLCPCB column layout
Blinky.pcb.svg          the whole board as one SVG document
Blinky.sch.svg          the schematic drawing, see schematic-graphic.md
README-fab.txt          status and summary
manifest.json           every other file with its size and sha256
Blinky-fab-0.1.0.zip    all of the above
```

- The zip is `<name>-fab-<revision>.zip`, or `<name>-fab-dev.zip` without a revision.
- Gerbers are X2, in mm, y up. Pads other than circles are regions. Stroke text is drawn with a round aperture as wide as its thickness.
- Circular arcs stay arcs: an `A` command with equal radii, a `<circle>`, the corners of a `<rect rx>`, `roundedRect`, `circle` and `slot`. A layer with one sets `G75*` once and draws each with `G02*`, clockwise from the top, or `G03*`, `I` and `J` from start to centre. Bezier curves, elliptical arcs and zone fills are segments.
- Silkscreen is cleared from the mask openings of its side it overlaps, as KiCad's `--subtract-soldermask` does: each such opening is a clear region after the legend.
- A zone fill with holes is an outer region and clear holes, the outer before any pour inside its holes, at any depth.
- A filled path with holes, such as the ring of a © sign, is one dark region whose contour runs into each hole and back along one cut line, so nothing earlier on the layer is erased.
- A paste layer with nothing on it, a side without SMD pads, is not written, and README-fab says so. A pad with paste windows of its own, `pasteRatio`, `pasteShrink` or `paste` windows, prints those.
- Fab, courtyard and user layers are not exported.
- The job file carries the layer count, thickness, finish and a `MaterialStackup` entry per layer.
- A failed entry leaves its last set in place with a `STALE` file in it, see cli.md.

## The order package

- `<name>.ipc` is the IPC-D-356A netlist for the electrical test, `UNITS CUST 1`, 0.001 mm, y up. One fixed column record per pad and via: `317` plated hole, `327` surface pad, `367` non-plated hole; the net, `N/C` for none, an `NNAME<n>` alias past 14 characters; ref, `VIA` for vias, and pad; drill with `P` or `U`; access `A00` through, `A01` top, the copper count bottom; centre, size, rotation; mask `S0` covered to `S3` open both sides.
- `<name>-drill-report.txt` lists each drill file with its layer span and every tool: diameter, holes, vias and slots.
- `<name>-PTH-drl_map.svg` and `-NPTH-` draw the outline and each hole at size with one symbol per tool, and a legend of symbol, diameter and count.
- `manifest.json` names the board, revision, target, generator and date, and every other file of the set with its size and sha256. It is in the zip too; the zip itself is not in it. The generator is `pcbjs <version>`, the version of @pcbjs/export that wrote the set, which the Gerber `TF.GenerationSoftware` header, the job file and the `Generated` line of README-fab name too.

## Reproducible builds

Every file that carries a date, the Gerbers, drill files, job file, netlist, report, README-fab, manifest and the zip entries, carries the same one: `pcbjs build --date <iso>`, else `SOURCE_DATE_EPOCH` in seconds, else now. Two builds of one tree at one date are byte identical, zip included, in any time zone. `SOURCE_DATE_EPOCH=$(git log -1 --format=%ct) pcbjs build` stamps the commit time.

## Gerber self check

`pcbjs build` and `pcbjs check --fab` read every copper Gerber and the outline back and compare them with the board:

- each copper layer against the board's copper of that layer, pads, tracks, vias, fills, graphics and text: a symmetric difference above 0.01 mm², once slivers thinner than 12 µm from arc chords are dropped;
- copper against the outline the `Edge.Cuts` file draws: copper outside it or inside a cutout;
- the outline read back against the board's outline;
- the pads of each net: pads the board joins through copper and plated holes must stay joined, and pads of two nets must stay apart.

Each difference is a DRC error `fab-mismatch`, so the set is not orderable. README-fab carries a `Gerber self check: passed` line. `pcbjs check` without `--fab` and `pcbjs dev` skip it.

## README-fab.txt

It starts with `STATUS: ORDERABLE`, or `STATUS: NOT ORDERABLE` with the error counts. Then: the board size and counts, a `3D models` line with the parts from model files, generated and with no model, as 3d.md defines them, the sourcing line, the stackup layer by layer, every rule value, the hole sizes, the DRC and ERC counts with every finding in the same lines as `pcbjs check`, the self check line, the file list and notes. A target's second line names the target, its fab and its place in the list.

- `fabNotes={['Single board, no panel.', 'Remove the order number.']}`, order form choices and the like, opens the Notes. `<PCB>`, a preset, a variant target and `defineDefaultBoard` take it; the lines join defaults first, then the preset or target, then `<PCB>`, each once.
- The Notes name each font the text uses: Hershey Simplex and NewStroke with their provenance from fonts.md, an outline font with its copyright and licence.

## BOM and placement

- `bom.csv` groups footprints with the same value, footprint id and fields. Its columns are `Refs`, `Value`, `Footprint`, `Qty`, `MPN`, the number resolved for the board's tags, `Source`, the tag matched or `MPN`, `Manufacturer` and `Datasheet`. Then one column per other field, one per `MPN:<tag>` key, and `MPN:*` with the catch-all when a tagged number replaced it in some row.
- Footprints with `bom={false}` are left out.
- `cpl.csv` has `Designator`, `Val`, `Package`, `Mid X`, `Mid Y`, `Rotation` and `Layer`, y up. It lists footprints with both `pos` and `bom` set.
- DNP parts, `dnp` on a placement, stay on the board and in the DRC but are left out of both files; README-fab names them.
- `Mid X` and `Mid Y` follow `cpl={{ origin }}` on the board or preset: `'center'`, the courtyard centre taken in the part's own frame, else its pads' extent, as JLCPCB and most assemblers expect; or `'footprint'`, the footprint origin, pin 1 for a pin header. JLCPCB presets default to `'center'`, every other board to `'footprint'`. README-fab says which.

## The .pcb.svg document

`<name>.pcb.svg` is a valid SVG any browser draws, with the board data in the `pcb:` namespace `https://pcb.svg/ns/1`. Geometry is in mm, y down.

- `<metadata>` holds `pcb:board`, `pcb:rules` after defaults, `pcb:nets`, `pcb:footprints` with absolute positions, and `pcb:drc` with the counts.
- One `<g pcb:layer="…">` per layer, back to front. Each element has `data-id`, `data-kind` of `pad`, `track`, `via`, `zone`, `graphic` or `text`, and `data-net`, `data-ref` and `data-pad` where they apply.
- Holes are drawn last in the background colour. Text is a stroked path with its string in `pcb:text`. Arcs are `A` commands, as in the Gerbers.
- `boardSvg(board, { vars: true })` from `@pcbjs/export/svg` writes the same document with every colour as a CSS variable that falls back to the default: `--pcb-<layer>` with `.` as `_`, such as `--pcb-F_Cu`, on a class per layer group, `--pcb-canvas` behind the board and in its holes, and `--pcb-substrate` under the layers inside the outline. A page that inlines it sets them per theme; the docs site does.
