---
'@pcbjs/core': patch
'@pcbjs/compile': patch
---

`.solver(fn)` on a route lays out each of its automatic legs before the router, or returns null to leave the leg to it; `ctx.route()` reads the routes solved before, and reading a later result is `solver-order`. `board.routing.solved` counts the legs.
