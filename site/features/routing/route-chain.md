---
title: Route by hand, or leave a leg to the router
status: shipped
docs: routing
fixture: site/demos/route.pcb.tsx
view: 3d
flag: route(a, b)
evidence: packages/pcbjs/tests/route-chain.test.mjs
snippet: site/demos/route.pcb.tsx
key: true
---

A chain such as `.H(12).V(5)` draws a route your way; ends alone leave the leg to the autorouter.
