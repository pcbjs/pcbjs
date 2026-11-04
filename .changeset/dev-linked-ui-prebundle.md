---
'@pcbjs/cli': patch
---

`pcbjs dev` prebundles a linked `@pcbjs/ui`, one that resolves outside `node_modules`, again whenever its built `dist` or that of `@pcbjs/core`, which the prebundle bundles, changes, at start and while the server runs, and reloads the page, so the dev server no longer serves an old ui bundle beside a new `style.css`.
