---
title: Board tests and golden fab sets
status: shipped
docs: testing
fixture: examples/demo/blinky.pcb.tsx
view: 2d
flag: pcbjs test
evidence: packages/cli/tests/board-tests.test.mjs
---

Assert design intent against the compiled board, and catch any change to the copper with a golden set.
