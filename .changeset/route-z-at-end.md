---
'@pcbjs/compile': patch
---

`.Z()` draws nothing when the chain is already within 1 µm of the end, as after an arc to the pad, instead of a zero-length track.
