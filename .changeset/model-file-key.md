---
'@pcbjs/core': patch
'@pcbjs/compile': patch
'@pcbjs/export': patch
'@pcbjs/cli': patch
'@pcbjs/lib': patch
'@pcbjs/kicad': patch
---

A model file is `{ file, offset?, rotate?, scale?, fallback? }`, and a KiCad library model in code is `kicad:<Lib>.3dshapes/<Name>.step`. The compiled footprint keeps the file as written and its absolute `path`.
