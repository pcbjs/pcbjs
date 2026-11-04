---
'@pcbjs/viewer': patch
---

The viewer works on references. `?select=` and the embed message `pcbjs:select` take any reference of docs/refs.md: a part, `CH2/R01`, a pad, an instance, `net:GND`, `route:vccTrunk`, `pair:1`, `item:…` or a finding id, selecting and framing what it names, and a selection made later follows into the URL. `pcbjs:finding` focuses a finding by its exact id, the Findings panel marks it and keeps it across a recompile by fingerprint, and each row shows its refs with the id on hover. Hovers travel between viewers and to an embedding page by item uid, `{ uids, refs, net }`. Pads print as `R1/2`, the chip adds a part's tree path, and the Nets list names routes as `route:<name>` or `pair:<n>`.
