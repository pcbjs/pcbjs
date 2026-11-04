---
title: Review a fabrication package
description: Build the output, inspect its status and review the files that will be manufactured.
---

# Review a fabrication package

A fabrication package is a concrete output to inspect, rather than just a successful command. This lesson takes a checked design through the export checks and identifies the files to review before handing it off.

Use the project from Getting started or one of the complete [examples](/examples). The small exercises elsewhere in Advanced teach individual features and may still have unfinished electrical connections.

## Check the source and exported copper

From the project directory, run:

```sh
npx pcbjs check
npx pcbjs check --fab
npx pcbjs build
```

The first command includes TypeScript checking when the project has a `tsconfig.json`, as well as the board's implemented design checks. The fabrication check reads exported copper and outline geometry back and compares it with the board. `build` writes the fabrication set and viewer site.

Resolve errors by following each finding to its affected object. Review warnings in the context of the actual board. Rebuild after a repair so the package reflects the source you inspected.

## Locate the output for the correct board

By default, each set is under `.pcbjs/fab/<board-name>/`. Open its `README-fab.txt` first. Check the board name, revision and target, then read the status and the Gerber self-check result. A failed entry can leave an older set marked `STALE`; do not mistake that retained output for the new design.

| Review | Files to inspect |
| --- | --- |
| Board shape and layer registration | Outline and copper Gerbers |
| Holes, plating and slots | PTH/NPTH drills, drill maps and drill report |
| Exposed pads and assembly openings | Mask and paste Gerbers |
| Component identity and orientation | Silk Gerbers, `bom.csv`, `cpl.csv` |
| Package identity and integrity | `README-fab.txt`, `manifest.json`, revisioned zip |

Open the Gerbers in the fabricator's preview or another suitable viewer. Compare the outline, mounting holes and important dimensions with the design. Review drill, mask, paste and placement outputs explicitly: the copper self-check does not independently re-read all of those files.

## Review assembly data

Check that populated and unpopulated parts match the intended build. DNP parts remain on the board and in DRC but are omitted from BOM and placement outputs. Confirm sourcing fields, package orientation and the placement origin convention used by the selected fabrication preset.

For a project with multiple targets, repeat this review for the target you will order. A clean first target does not establish the status or manufacturing choices of the others.

## Hand off the reviewed artifact

Use the revisioned fabrication zip from the reviewed set and retain its manifest and source revision with the order. `STATUS: ORDERABLE` means the implemented checks passed; it does not verify the circuit's electrical intent or replace a review of the manufacturer's requirements.

You have now linked one source revision to one inspected output package. The [Fab set reference](/docs/fab-set) documents each file and the self-check's coverage. [Fabrication presets and variants](/docs/fab) explains how the chosen target changes manufacturing settings.
