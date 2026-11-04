---
'@pcbjs/core': patch
'@pcbjs/cli': patch
'@pcbjs/ui': patch
---

A live `?pcb:board` in dev follows the session compiling it as a dev page does: its `BoardRef` names the session, reached on the session socket through the site's own dev server at `/@pcbjs/session/`, same origin only, and the store every component of that board shares takes its facets, invalidates and heartbeat there through the same live path as a page's boards, so a newer ref fetches nothing. Without a live session a newer ref fetches again what was fetched.
