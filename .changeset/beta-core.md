---
"@pcbjs/core": patch
---

First beta. The board and element types and the JSX runtime for writing a PCB as TypeScript, with units, net classes, stackups, rules and their defaults, the project config and variants. A schematic is drawn with `<Schematic>`, symbols and wires in grid units, or placed for you. Text is stroked in Hershey Simplex or NewStroke, or filled from an outline font.

`stitch(net)` keeps its source range, so its vias open the `stitch()` call.
