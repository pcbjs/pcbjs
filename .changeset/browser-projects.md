---
'@pcbjs/core': patch
'@pcbjs/compile': patch
'@pcbjs/cli': patch
---

One browser compile worker serving boards of several projects keeps each project's parts, bound routes and default board apart, keyed by the module's new `project` field, so a bound route of one project's `pcb.tsx` is never another's unplaced route.
