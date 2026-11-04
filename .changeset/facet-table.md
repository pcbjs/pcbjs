---
'@pcbjs/core': patch
'@pcbjs/export': patch
'@pcbjs/cli': patch
'@pcbjs/ui': patch
---

One table, `FACETS` in `@pcbjs/core/site-facets`, names each facet's keys and the views that draw it; `FacetData`, `splitSite`, `joinSite`, the session's routing of facets to viewers and the views' demand read it. The compile's stage declarations name when each facet streams, and `facetsOf(view)` and `EVERY` answer what a view needs and what every viewer takes. The `model` facet now streams after place, with each STEP model's mesh extent, courtyard and fit issue, so a 3D view no longer runs the exports stage on every edit. A session, `check` and the one-shot compiles build only the fab set and the site data; the board SVG and the GLB are made when the dev server or `pcbjs shot` asks for them, and only `build` and `build --lib` export the GLB with the compile.
