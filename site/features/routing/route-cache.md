---
title: Route cache and holds
status: shipped
docs: autorouter
fixture: examples/sdram/pcb.tsx
view: 2d
flag: .pcbjs/routes
evidence: packages/compile/tests/route-cache-draft.test.mjs
---

An unchanged board routes from its cache; a held route keeps its copper while the board changes around it.
