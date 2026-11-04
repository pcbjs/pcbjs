---
title: Nets and parts as values
status: shipped
docs: schematic
fixture: examples/demo/blinky.pcb.tsx
view: sch
flag: .connect()
evidence: packages/pcbjs/tests/schematic.test.mjs
---

A net is a value and a part is a footprint factory called with its value; `.connect()` gives each pin its net by name.
