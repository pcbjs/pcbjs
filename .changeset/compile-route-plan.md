---
'@pcbjs/compile': patch
---

The `manualCopper` stage lays every route's manual copper, necks and pair stubs before the `beforeRoute` slot, so a plugin stage there sees it, and the keystroke tier draws the manual copper and necks of every route, including the drawn pieces of a route with automatic legs.

The `tune` stage is cached on its own: the router hands it the laid out pairs as data, and routing no longer reads silk, courtyards or the edit nodes, so a silk label edit restores the routing from the stage cache and retunes only when drawings within a tuned route's reach changed.
