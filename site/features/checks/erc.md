---
title: ERC on the netlist
status: beta
docs: findings
fixture: examples/demo/blinky.pcb.tsx
view: sch
flag: unconnected-pin
evidence: Pins have no electrical roles yet, so ERC checks connectivity, not drivers against loads.
---

Unconnected pins, single-pin nets and the schematic checks, run with every compile.
