---
'@pcbjs/core': patch
'@pcbjs/cli': patch
---

A footprint factory with no value takes its options as the one argument, `MountingHole(3.2)({ ref: 'H1' })`, and `pcbjs model add --write` writes that form.
