---
'@pcbjs/ui': patch
'@pcbjs/export': patch
---

Generated models are opaque solids: a chip LED's lens is an opaque solid in the colour of its `color` option with a mild glow, grey-white without one, depth written and never transparent, as is a PLCC LED's fill. The board GLB, and so `pcbjs shot`, draws an LED's body box in the same lens colour with an emissive factor instead of the dark body grey; only the mask blends.
