---
title: The edit loop in one command
status: shipped
docs: check
fixture: examples/demo/blinky.pcb.tsx
view: 2d
flag: pcbjs check
evidence: packages/pcbjs/tests/cli-output.test.mjs
---

Compile, route, DRC, ERC and the type check without writing a file, one line per board and per finding.
