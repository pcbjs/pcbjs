---
'@pcbjs/ui': patch
'@pcbjs/viewer': patch
'@pcbjs/cli': patch
---

`@pcbjs/ui` has an entry per view: `@pcbjs/ui/view2d`, `@pcbjs/ui/view3d` and `@pcbjs/ui/sch` each export their view and an editor `Pane`, `@pcbjs/ui/panels` the chip, the findings list and the side panels, and `@pcbjs/ui` all of it, the entries sharing their chunks. An editor's pane, any page with `?ide=1&view=`, is served as its own page that loads that view's entry alone, the rails loading when a drawer opens, so a 3D pane no longer carries the 2D view, the schematic or the panels.
