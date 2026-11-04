---
'@pcbjs/ui': patch
'@pcbjs/viewer': patch
---

Connection indicators: in 3D every ratsnest connection is one dashed arc from pad surface to pad surface, clearing the tallest part under it by 1 mm, the dashes marching; across sides it ends above or below the far pad with a stem through the board to it, or to an inner layer, ringed on the surface, and two ends on the back arc under the board. The selection's connections are drawn in the accent. In 2D the selection's connections are one line from the start layer's colour to the end's, a filled dot on the active side, a ring for the far side and a ring with the index for an inner layer. A ratsnest button in both views shows or hides them. The viewer numbers `pcbjs:agents` and `pcbjs:agent:sent`, which no longer read as a missing frame.
