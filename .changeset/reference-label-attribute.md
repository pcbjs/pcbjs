---
'@pcbjs/core': patch
'@pcbjs/compile': patch
'@pcbjs/kicad': patch
'@pcbjs/export': patch
---

Use `ref:at` to position or hide a footprint's reference label. Generated reference labels retain their own source range for precise editor focus, including rotated placements on the back of the board. KiCad imports emit the same attribute.
