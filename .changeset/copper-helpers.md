---
'@pcbjs/core': patch
'@pcbjs/compile': patch
---

Copper is made by the helpers `route()`, `pour(net, layer, area, opts)`, `via(net, at, opts)`, `stitch(net, opts)` and `keepout(area, { layers, tracks, vias, pours, except })`, whose `layers` is a list of copper layers or left out for every one. `null` as the net of `pour()`, `via()` or a coordinate route's `.net()` is copper on no net: foreign to every net in DRC, with findings that say no net, never unconnected, and a pour on no net fills last, keeps every island and keeps its clearance from every net.
