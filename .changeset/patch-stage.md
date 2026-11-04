---
'@pcbjs/core': patch
'@pcbjs/compile': patch
'@pcbjs/export': patch
'@pcbjs/cli': patch
'@pcbjs/viewer': patch
'@pcbjs/skills': patch
---

Patches: `patch(ref, op, hash)` edits copper and placement by reference with six operations, `move`, `nudge`, `via`, `reroute`, `width` and `hold`, from `<PCB patches>`, inline in the tree and the default export of the `.patches.ts` file beside the entry, merged in that order. Each carries a hash of its target; a missing or changed target skips it with a `patch-stale` warning. Moves of parts and groups run at the end of `place`, `hold` and `reroute` before the router, the rest after `tune`. `pcbjs patch hold <route>` writes the copper of a route's automatic legs as a hold, which the router places first as an obstacle; the routing line and report count `held` legs, route records carry their `hash` and each leg its `copper`, and the route file keeps legs and tunes only.
