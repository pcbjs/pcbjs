---
title: Automatic placement and followers
status: shipped
docs: placement
fixture: examples/psu/pcb.tsx
view: 2d
flag: at="auto"
evidence: packages/pcbjs/tests/placement.test.mjs
---

Leave a slot of `at` to the placer, a solver or a cost of your own, and freeze the result with `pcbjs place --write`.
