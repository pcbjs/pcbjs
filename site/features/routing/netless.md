---
title: Copper on no net
status: shipped
docs: pours
fixture: examples/demo/coin.pcb.tsx
view: 2d
flag: pour(null, 'F.Cu', board())
evidence: packages/compile/tests/netless.test.mjs
---

Pours, vias and routes with no net, foreign to every net in DRC, to fill a board or draw isolated copper.
