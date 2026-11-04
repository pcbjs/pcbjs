---
title: A cached compile stage graph
status: shipped
docs: design
fixture: examples/qfn-breakout/pcb.tsx
view: 2d
flag: .pcbjs/cache
evidence: packages/pcbjs/tests/stage-cache.test.mjs
---

Each stage keyed on its inputs, so an edit recompiles only what it changed.
