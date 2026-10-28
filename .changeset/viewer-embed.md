---
'@pcbjs/viewer': patch
---

`?embed=1` shows a built board's view alone for an iframe, 3D by default, driven by `pcbjs:view`, `pcbjs:theme`, `pcbjs:hover` and `pcbjs:select` messages from the parent, and posts `pcbjs:ready`, `pcbjs:hover`, `pcbjs:select` and `pcbjs:view` back.
