---
'@pcbjs/core': patch
'@pcbjs/compile': patch
'@pcbjs/export': patch
'@pcbjs/cli': patch
---

Grids: `defineGrid(name, { pitch, minor, origin, angle, frame })` attached on `<PCB grid>` and `<g grid>` makes the bare numbers of part and group positions under it grid units; origins take a coordinate, a pad handle, a footprint point from `defineFootprint(render, { points })` or a function of the placed parts, and `frame` adopts a part's placed frame. A grid that reads a part placed under it is the compile error `grid-cycle`, and a `<g>` that attaches a grid with a frame takes no `at`, `grid-frame`. The board model and the viewer's board data carry the grids and what each part, group and route lets the tools change; `pcbjs inspect --grids` prints them. `<Schematic grid>` and `<Sheet grid>` take a grid as well as the number.
