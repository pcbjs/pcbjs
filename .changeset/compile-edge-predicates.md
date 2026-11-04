---
'@pcbjs/compile': patch
---

DRC, connectivity and pour island removal test copper by its edges instead of with Clipper booleans: one candidate pass per layer joins same-net copper, finds shorts and hands DRC the pairs it checks for clearance, island removal hands connectivity the joins it already tested, and hole to copper is the same edge distance. Clipper still builds fills, offsets and witnesses, and decides the rare pair that touches or sits within a few microns of a limit, so every finding is as before. The checks of a board with large pours run several times faster.
