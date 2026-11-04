---
title: Declared current-width checks
status: shipped
docs: routing
fixture: examples/psu/pcb.tsx
view: 2d
flag: current-width
evidence: packages/pcbjs/tests/current.test.mjs
---

Checks declared route widths against the IPC-2152 baseline for the stated current and copper thickness. Automatic pad neck-downs are not checked; inspect their widths separately.
