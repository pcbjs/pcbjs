---
'@pcbjs/cli': patch
---

The session holds each board's selection: `session/select` sets it from a viewer, a client or an agent and stamps it for `pcbjs:select` to every viewer of the board, the editor's selections set it through the language server, and one set elsewhere goes to each editor as `pcbjs/select` with a range per member. `pcbjs shot --select` draws the viewer's highlight: a 2 px outline 35 percent through what hides it and the net as context.
