---
title: Check the result
description: Read DRC, ERC and TypeScript findings, inspect the board, then build its fabrication files.
---

# Check the result

After each edit, run the checks from your project folder:

```sh
npx pcbjs check
```

This compiles the board, routes automatic legs, checks the physical and electrical design, and type-checks the configured entries. The supplied Blinky is expected to have zero DRC errors, warnings and unconnected nets, and zero ERC errors and warnings.

<GuideDemo example="blinky-checks" />

## Read the three kinds of feedback

| Check | What it examines | An example to investigate |
| --- | --- | --- |
| DRC | Copper, geometry and manufacturing rules | A `clearance` finding names objects that are too close; `unconnected` means a net's copper is not fully joined |
| ERC | Electrical declarations and other design requirements | `unconnected-pin` identifies an omitted pin connection; `unsourced-part` identifies missing part numbers when sourcing is required |
| TypeScript | The design program and typed APIs | An unknown pin handle, a misspelled property or an incompatible argument |

A clean schematic connection does not guarantee connected copper. Conversely, copper can meet its spacing rules while a pin has the wrong intended net. Read both the declarations and the compiled board.

## Investigate a finding

A finding includes its rule, affected references and a message explaining the problem. It can also include the layer, position and source location. Start with that location and inspect the named objects.

For Blinky, these commands connect the header's logical role with its actual geometry:

```sh
npx pcbjs inspect J1
npx pcbjs inspect J1/3
npx pcbjs inspect SIG
```

Open the dedicated **DRC/ERC** viewer to read finding details, expand the list or move between errors with previous/next. Selecting a finding focuses its affected objects across applicable views; the drawing itself shows only the finding type on hover. The [Blinky viewer](/examples/demo-blinky) shows the supplied example; `npm run dev` shows your local edits. In VS Code, the pcbjs extension can show the viewer beside the source, as described in [Editor setup](/docs/editor).

Fix the cause, save and run `check` again. If routing fails, inspect the blocked corridor before moving several parts at once. An early `route-failed` finding can explain later unconnected-net findings.

## Keep the loop short

1. Make one small edit to the schematic or board.
2. Look at the affected objects in 2D or Schematic; use 3D for the board and part arrangement.
3. Run `check` and read any changed findings.
4. Keep the result or restore the previous version before the next experiment.

`npx pcbjs check --watch` repeats the check on save. A warning does not make the command fail, but still needs review. A DRC or ERC error, an unconnected net, a compile error or a type error causes a failing exit code.

## Build when ready

Once the intended design is checked and visually reviewed:

```sh
npm run build
```

The build writes the fabrication set under `.pcbjs/fab/Blinky/` and the static viewer site under `.pcbjs/dist/`. It runs fabrication checks but does not replace `check`'s TypeScript validation. Review `README-fab.txt`, the fabrication files and the part choices before ordering.

You have followed one board from connections to physical output. Continue with the [Advanced guide](/guide/advanced/) when you need reusable circuits, constraints or fabrication workflows. Use the [Check reference](/docs/check) and [Findings reference](/docs/findings) to investigate specific results.
