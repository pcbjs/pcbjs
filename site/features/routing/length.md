---
title: Length targets and match groups
status: beta
docs: length
fixture: examples/eth-phy/pcb.tsx
view: 2d
flag: .match()
evidence: Meanders are single sided and added after routing; a route too long or with no room is reported, not rerouted.
---

Targets per route and skew per group, met by meanders the tuner lays and reported by `inspect --lengths`.
