---
title: A negotiating autorouter
status: beta
docs: autorouter
fixture: examples/qfn-breakout/pcb.tsx
view: 2d
flag: route(a, b)
evidence: Negotiation reroutes automatic legs whole and never shoves held or drawn copper; a tangle may still need a waypoint.
---

A maze router that picks layers and vias, negotiates contested space between legs and caches every leg by its surroundings.
