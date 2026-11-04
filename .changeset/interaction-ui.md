---
'@pcbjs/ui': patch
---

The views follow the interaction contract: a press on a selected part starts a drag wherever its pad lies under a track or a pour, where it panned before; a part inside an entered instance or group, `CH2/R`, gets its tools; an instance lights as a whole, its parts, the routes its layout made and the text it drew; cmd or ctrl on an automatic leg selects the leg; a ratsnest line selects its net; a pour draws no context; a hover tells the other views and viewers only what a click would select, never a net beside it; shift lifts snapping and cmd or ctrl keeps a drag to one axis; tools show only in a read-write session and the chip otherwise says why, `read-only`, `no placement` or `select a part`; the chip confirms each write for a second and names a failed one; a session older than the viewer shows a banner asking to restart it.
