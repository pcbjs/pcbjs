---
'@pcbjs/compile': patch
'@pcbjs/export': patch
---

Check the copper ring around the whole plated hole or slot against the pad's shape, including rotated slots and custom copper outlines. A slot with too little copper at either end or side now reports an annular-ring error.

The Gerber self check reports a fabrication error when a copper layer or outline file is missing, or the outline has no closed contour. An unused copper layer's empty Gerber must still be present.
