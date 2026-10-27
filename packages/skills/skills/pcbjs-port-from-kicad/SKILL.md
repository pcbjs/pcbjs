---
name: pcbjs-port-from-kicad
description: Port a KiCad board or footprint to pcbjs and prove the port matches. Use when given a .kicad_pcb, .kicad_mod, .kicad_dru or .kicad_sch to bring into pcbjs, when running pcbjs import board or pcbjs import footprint, when comparing a pcbjs board against KiCad by netlist or Gerbers, or when porting an Altium, Eagle or EasyEDA design by way of KiCad's importers.
---

# Port a KiCad board to pcbjs

The importer writes a pcbjs project that compiles and matches the KiCad board pad for pad; the work is then to check that claim three ways and to fold the transcript back into intent. Keep the KiCad files untouched beside the port: they stay the source of truth until every check passes.

## Steps

1. **Branch.** Work on a branch or worktree; leave the KiCad flow and its outputs as they are.
2. **Import.** `npx pcbjs import board path/to/board.kicad_pcb -o pcb/board.tsx`. It reads the `.kicad_pro`, `.kicad_dru` and `.kicad_sch` of the same name, writes `pcb.config.ts` and `tsconfig.json` at the project root, and the board's files beside `-o`. Commit the raw output as it is, so every later edit is a diff against it.
3. **Check 1, DRC and ERC.** `npx pcbjs check --fab`, with `.pcbjs/routes` deleted and again warm. `--fab` reads the Gerbers back. Decide every finding: a KiCad rule the importer could not map, a pair where KiCad lowered one side only, or a check KiCad lacks such as silk width on lines.
4. **Check 2, netlist and copper.** Every KiCad pad at the same board position with the same net, size and drill; then tracks and vias. references/netcheck.md has the script.
5. **Check 3, Gerbers.** Both fab sets rendered on one frame, layer by layer. references/gerbers.md has the method and the expected differences.
6. **Refine.** Run checks 1 and 2 after every step: pin names on the footprints you connect by name, `kicadFootprint('Lib:Name')` for footprints that match a library you have, standard library families where they fit, routes you want redone as `.X()` legs and the rest `.lock()`ed, the fab preset in place of the imported stackup and rules.
7. **Write it up.** A table per check with the result, each remaining difference with its cause and whether it is acceptable, and the time it took.

## The mapping

references/importer.md has what the importer writes and how each KiCad concept lands: the frame, back-side angles, refs, text in NewStroke, pads and padstacks, net names, `.kicad_dru` rules to overrides, `.kicad_sch` fields to sourcing, DNP and BOM flags, models. `npx pcbjs docs import` and `npx pcbjs docs kicad` are the full topics.

Two rules catch most hand ports: a KiCad back part at angle `a` is `side="B"` at `a + 180` here, and a pad position copied from a `.kicad_mod` lands at the same place, since both tools use mm with y down.

## What the importer cannot see

- Rules kept outside the KiCad files: a generator's asserts, a DFM script, an owner's rule sheet. Move each into DRC or a contract, see the pcbjs-best-practices skill.
- BOM and assembly intent kept in scripts: a no-BOM list, assembly variants, CPL rotation corrections, panel definitions. Set `bom`, `pos` and `dnp` by hand, and `fabNotes` for order notes.
- `.kicad_dru` rules that map onto no override, such as courtyard rules or rules between two footprints. The config lists them as comments; decide each.
- Thermal gap and spoke width per pad or zone, a board-wide paste ratio, dimensions, images, groups, text boxes and tables.
- Zone fills: pcbjs fills its own. Expect pour areas within one or two percent and different relief shapes.
- The schematic drawing: pcbjs keeps the netlist as code in `.sch.ts`; there is no sheet.

## From Altium, Eagle or EasyEDA

pcbjs reads KiCad files only, so go through KiCad's own importers:

1. Open the board in KiCad's PCB editor with File, Import, Non-KiCad Board File: Altium `.PcbDoc`, Eagle `.brd`, EasyEDA Standard and Pro exports, CADSTAR, P-CAD and others. Import the schematic in the schematic editor the same way when there is one, so part fields reach the `.kicad_sch`.
2. Refill the zones, run KiCad's DRC and fix what the conversion broke: net classes and custom rules usually need entering again, and embedded footprint libraries lose their library links.
3. Save as `.kicad_pcb`, then port it with the steps above. Compare check 3 against the original tool's own Gerbers, not KiCad's, since the conversion is a step that can change copper.

## Done means

- `pcbjs check --fab` cold and warm with the same findings, each one explained; `STATUS: ORDERABLE` where the KiCad board was orderable.
- 0 net differences, every pad, track and via accounted for.
- Edge.Cuts and drills identical; copper, mask and paste differences small and explained; silk explained.
- The KiCad flow untouched and still building.
