---
'@pcbjs/kicad': patch
---

The board importer writes tracks as route chains of `.L()` segments and `.A()` arcs that end on a pad or start from the open end, copper on no net as `pour(null, …)`, `via(null, …)` and `.net(null)`, and keepouts as `keepout(area, { layers })`.
