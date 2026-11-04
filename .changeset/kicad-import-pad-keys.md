---
'@pcbjs/kicad': patch
---

`pcbjs import board` names a pad by its key, `U1.G` or `U1[3]`, writes a stub from a pad to an open point as `route(J1[2], '5 5').Z()` with the pad first, leaves the per-layer colour off the stackup layers and keeps the board's `maskColor` and `silkColor`.
