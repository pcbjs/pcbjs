---
'@pcbjs/core': patch
'@pcbjs/compile': patch
'@pcbjs/fab': patch
'@pcbjs/cli': patch
'@pcbjs/viewer': patch
---

The stackup alone sets a board's copper layers and thickness, `stackup={fourLayer({ thickness: 1.2 })}`; its `maskColor` and `silkColor` colour both sides. `defineDefaultBoard` carries the default rules. Outline fonts are declared on `<PCB fonts>` as `{ file, weight? }`, and `<text font>` is a name; `hershey` is the default stroke font. A variant target gives `rules` and `fabNotes` on the target and the rest of the board under `board`. A preset module default-exports its component, whose data is `PCB.preset`. `BASE` and `mergeRules` come from `@pcbjs/lib/rules`, `isBoundPCB` from `@pcbjs/fab`. Palette names match whatever their case, spaces, `_` or `-`, in a preset and in `maskWebByColor` alike. Sourcing keys and tags match as written, `MPN` in capitals. `repo` is `{ url, ref?, dir?, kind? }`. An entry default-exports the `<PCB>` element.
