---
'@pcbjs/ui': patch
'@pcbjs/viewer': patch
'@pcbjs/cli': patch
'@pcbjs/core': patch
'@pcbjs/pcbjs': patch
---

New package `@pcbjs/ui`: the viewer's 2D, 3D and schematic views, its selection chip, findings list and panels as prebuilt Vue components with their types and one `style.css`, `vue` and `three` as peers. `View2D`, `View3D`, `SchView`, `PcbViewer`, `PathChip`, `FindingsList` and the panels take a board as site data or a `?pcb:board` ref, share one store per board, theme by `--pcbjs-*` custom properties, and render on the server without a browser global; `createViewer` is the store. `@pcbjs/viewer` is now the app shell around them, behaving as before; `pcbjs dev` prebundles the library, and `pcbjs dev --ui-src [folder]` serves it from the source of a pcbjs checkout instead, refused on an install. `@pcbjs/core/site-facets` adds `BoardRef`, `FacetHeader`, `BoardSummary` and the data type of each facet.
