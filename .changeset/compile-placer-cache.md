---
'@pcbjs/compile': patch
---

The stage cache keeps the auto placement by its inputs, so a compile whose edit leaves the placed parts' inputs alone runs no placer, and `check --verbose` prints `placer hit` or the placer's time under the place stage. Variant targets share one routing only when their auto placements agree, and a target's `board: { place }` sets its placer seed when the element gives none.
