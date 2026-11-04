---
'@pcbjs/cli': patch
---

The dev server runs only inside a session: `pcbjs dev` and `pcbjs session serve` serve every project as a workspace, a single project as a workspace of one, and compile in a worker thread per project. A script starts a session with `pcbjs session serve` or `pcbjs dev` and reaches it through `.pcbjs/dev.json`.
