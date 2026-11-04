---
'@pcbjs/lib': patch
'@pcbjs/kicad': patch
'@pcbjs/lsp': patch
---

Every connector generator returns its footprint factory, as the other generators do: `PinHeader(4)('PZ254V-11-04P')`, `JST_XH(4, { drill })()`, `USBC('power6')('TYPE-C-31-M-17')`. `withPins(factory, names)` renames the pins of a generated footprint or a `kicadFootprint()`. `QFN` takes the exposed pad as the `ep` option. An LED's lens colour is the `color` option of `chip()`, and the named factories `LED0603`, `LED0805` and `LED1206` cover the chip LEDs. `@pcbjs/lib` holds the parts, footprints and helpers; rule sets, stackups and impedance are `@pcbjs/lib/rules`, `@pcbjs/lib/stackups` and `@pcbjs/lib/impedance`. `kicadFootprint` reads library folders from `kicad.footprints` of the config. `pcbjs import board` writes `rev` and a stackup builder for a board without a stackup.
