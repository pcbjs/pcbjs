---
"@pcbjs/export": patch
---

First beta. Writes the fab set of a board: Gerber X2, Excellon with slots, the job file, BOM and placement, SVG of the board and the schematic, and README-fab with every finding and an orderable status. Also writes the site data the viewer shows.

A source range lists in `outer` the ids it reaches only as a call site, so a click opens the call that drew an item, not a shorter layout element around it.
