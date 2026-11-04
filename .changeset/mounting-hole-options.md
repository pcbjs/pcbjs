---
'@pcbjs/lib': patch
---

`MountingHole(d, { pad, plated })` takes its copper ring as an option: `pad` is `true` for twice the drill or a diameter, `plated: false` leaves the hole unplated with the ring on both outer layers. The ring is on no net until `.connect({ 1: GND })` ties it.
