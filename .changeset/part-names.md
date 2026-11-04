---
'@pcbjs/core': patch
'@pcbjs/compile': patch
'@pcbjs/cli': patch
'@pcbjs/lib': patch
'@pcbjs/kicad': patch
'@pcbjs/lsp': patch
'@pcbjs/skills': patch
---

A part's ref is the name of the binding that holds it, in any file and in function bodies of a circuit build; a part made in a loop takes `{ ref }` in its options, and a placed part with no name is a compile error that suggests the next free one, which the language server offers as a code action. Circuit instances take an index, `channel(ports, 2)` or `channel(ports, 'CH2')`, and their parts are numbered from it, `CH2/R01` is `R201`. A bound route is `route:<name>`. A part or a bound route declared and never placed is a compile error. `.connect()` takes pins by name, a factory takes its value as a string then `{ ref, bom, pos, dnp, height, model }`, sourcing and BOM fields are `.source()`, and a placement takes `at`, `side`, `ref:at` and `thermal`. Every footprint on a board is a part, pinless parts included, so nets are `Net` values only and pads are named by their handles. `<Place part>` places a part the file cannot name on the board and in `<Schematic>`, a named `<g>` is a level of hierarchy, and the schematic drawing is the `drawing` export of the schematic module, in grid units. A part never connected, such as a mounting hole, raises no `unconnected-pin`.
