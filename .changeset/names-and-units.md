---
'@pcbjs/core': patch
'@pcbjs/compile': patch
'@pcbjs/lsp': patch
'@pcbjs/viewer': patch
'@pcbjs/cli': patch
'@pcbjs/export': patch
---

The board revision is `rev`, on `<PCB>`, in `defineDefaultBoard` and in the board data. `side` is `F` or `B`. Code names layers by their ids as written, `F.Cu`, `F.SilkS`, `Edge.Cuts`; one layer table serves the compiler, the language server, impedance, `inspect --layer` and the viewer URL, whose flags take `top`, `silk` and the like. Lengths take `mm`, `cm`, `m`, `mil`, `in`, `um` and `nm` in lower case; an angle is a number of degrees, `"90deg"`, or `"1.57rad"`. `at` is the string `"x y [rot]"` separated by spaces, a template string for computed numbers. The route end type is `RouteEnd`.
