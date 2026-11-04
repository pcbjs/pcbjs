---
'@pcbjs/kicad': patch
'@pcbjs/cli': patch
---

The board importer joins arcs into the route chains of their net, writes copper graphics as chains and pours on no net, part fields as `.source()` on each part in `pcb.sch.ts`, refs as the binding names, a hidden reference as `ref:at={false}`, library models as `kicad:<Lib>.3dshapes/<Name>.step`, project models relative to the module even when missing, and the rules as `defineDefaultBoard({ rules })`. Footprint keepouts are written and built as `keepout(area, { layers })`. `kicadFootprint` and `readFootprint` take `model: { kind: 'none' }` for no model. `pcbjs import board` prints the `defineDefaultBoard` line when it keeps an existing config.
