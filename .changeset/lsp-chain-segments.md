---
'@pcbjs/lsp': patch
'@pcbjs/vscode': patch
---

Segments follow the route chain: every end of `route(a, b, …)`, the waypoint of `.L(p)` and `.X(p)`, `.A()` arcs, and `.Z()` and `.X()` as the finish, switching one for the other; path segments are SVG path data only.
