---
'@pcbjs/core': patch
'@pcbjs/compile': patch
---

The chain's `.via(layer, { drill, size })` sets the drill and copper size of that via; without them it takes the route's `.vias()`, then the rules' default via.
