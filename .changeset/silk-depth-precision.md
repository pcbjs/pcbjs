---
'@pcbjs/ui': patch
---

Keep solder mask from tinting silkscreen when distant surfaces round to the same depth on software renderers. Apply a small depth-unit bias to silk, preserve it in grouped highlight prepasses, and retain occlusion by nearby component bodies.
