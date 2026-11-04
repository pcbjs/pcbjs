---
title: The binding name is the ref
status: shipped
docs: schematic
fixture: examples/demo/blinky.pcb.tsx
view: 2d
flag: const R1 = R0603('330')
evidence: packages/pcbjs/tests/bound-refs.test.mjs
---

The constant a part is bound to is its ref on the silk, in the BOM and in every finding, so a rename in the editor renames the part.
