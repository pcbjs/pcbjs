---
'@pcbjs/cli': patch
---

The session sends a facet only to the viewers whose `observe` names its board, its target and the facet, `fab` always and every board's `meta` to all, so a 2D pane no longer receives the schematic or the 3D models and a schematic pane no longer receives the layers; a viewer that never said what it observes still gets everything. A changed `observe`, a mode or a board switch, sends what the viewer lacks by the hashes it holds, and the heartbeat still names every facet.
