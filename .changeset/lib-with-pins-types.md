---
'@pcbjs/lib': patch
---

`withPins` on a factory with untyped pins, such as a `kicadFootprint`, types the pin names it gives, so `withPins(kicadFootprint(id), { G: 'G' })('x').G` type-checks.
