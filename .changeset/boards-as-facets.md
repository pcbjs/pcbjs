---
'@pcbjs/core': patch
'@pcbjs/cli': patch
'@pcbjs/ui': patch
'@pcbjs/viewer': patch
---

A page takes every board as its facets: the prerendered pages inline each board target as a `FacetSet` of `@pcbjs/core/site-facets`, its board, target and facets, and so do the dev server's board module and `pcbjs:boards`; a built site's `boards/<name>.json` is split into facets as it arrives. The views draw from the facets their board holds whichever way they came, as they do from a `BoardRef`'s and from the session's stream.
