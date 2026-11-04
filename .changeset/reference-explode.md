---
'@pcbjs/core': patch
'@pcbjs/export': patch
'@pcbjs/viewer': patch
---

In the exploded 3D view and the GLB's explode extras, a board placed with `reference()` and stacked above or below moves with the parts of the side it mates on, so the gap to its connector is kept. The site data's reference carries that `side`.
