---
'@pcbjs/core': patch
'@pcbjs/compile': patch
'@pcbjs/cli': patch
---

Board references lie over the side of the local mating part, `side: 'F'` or `'B'` overriding it, `stack: 'coplanar'` in the plane. `<mate name at side />` and `name` on a placement declare named points, carried in the board data, that `mate.remote` takes.
