---
'@pcbjs/core': patch
'@pcbjs/compile': patch
'@pcbjs/fab': patch
'@pcbjs/cli': patch
---

Add a board-wide via preference shared by standalone, routed, paired, stitched and patched vias, preserving explicit dimensions and keeping manufacturing minima separate. Report consistent board/class defaults in rulesAt. Describe underlength routes as below their length target and include existing tuning notes in query records.
