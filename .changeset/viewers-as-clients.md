---
'@pcbjs/core': patch
'@pcbjs/cli': patch
'@pcbjs/ui': patch
'@pcbjs/viewer': patch
---

A dev page is a session client like an editor or an agent: one WebSocket to `/__pcbjs/session` with a viewer's hello, its mode from the ready. It calls `session/observe` for what it shows, `session/select`, `session/hover`, `session/edit/*`, `session/send` and `session/resync` as JSON-RPC, and gets the facets, the heartbeat as `session/state` and the rest as events numbered on that connection. Vite's socket carries only hot updates of the viewer's own source. `pcbjs session status` and `session/clients` list the open pages, `pcbjs:editor` says when an editor attaches or leaves, and the protocol is 6. `@pcbjs/ui` exports `sessionSocket` and the `Transport` its store and the edit client take.
