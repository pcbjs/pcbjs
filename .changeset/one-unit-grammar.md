---
'@pcbjs/core': patch
'@pcbjs/compile': patch
'@pcbjs/lsp': patch
---

Lengths and angles have one grammar, shared by the compiler and the editor: the unit sits right after the number and an exponent may be written `e` or `E`, so `"1E-1mm"` compiles and `"10 mm"` is an error that names `"10mm"`. Angles take an exponent too, `"9E1deg"`.
