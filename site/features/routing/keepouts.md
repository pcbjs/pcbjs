---
title: Keepouts with exceptions
status: shipped
docs: layout
fixture: examples/sensor-hat/pcb.tsx
view: 2d
flag: keepout(layers, d, { except })
evidence: packages/compile/tests/route-findings.test.mjs
---

Areas no copper may enter, except the nets you list, honoured by DRC, pours and the router alike.
