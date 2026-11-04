---
'@pcbjs/lsp': patch
'@pcbjs/cli': patch
---

Assist mode: an editor cursor in an empty, unclosed or short argument of a route chain call, `.H(|)`, `.l(|`, `.X(|)`, or in an empty `at=""` gives the session an assist context per board, the command, the start point from the chain so far, layer, net, side, grid in effect and whether the command is relative, posted to the board's viewers as `pcbjs:assist`. The draft repair cuts such a call, so the chain compiles up to the cursor. `session/edit/begin` takes the tool `assist`: each update previews the trace a point gives, straight for `L`, `H` and `V`, one automatic leg against the current copper for `X`, with its clearance findings, `pick` choosing `l` when the straight trace is clean else `X`; the commit writes the argument through the editor and moves its cursor past the call.
