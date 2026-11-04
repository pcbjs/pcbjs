---
'@pcbjs/viewer': patch
---

The heartbeat check compares only the facets the page observes, so a facet the session no longer sends to it, the schematic in a 2D pane, never reads as out of sync. The hover goes to the session after the frame that draws it, so its wire form and the send stay off the pointer's frame.
