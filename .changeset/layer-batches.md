---
'@pcbjs/ui': patch
---

The 3D view draws each copper layer, each side's silk, mask skins and part bodies by material as one draw, round plating and a resistor's printed code as one instanced draw each, so a board costs about the same to draw at any item count: usb3-hub draws in 80 calls at rest, 16 of them the grid's labels, and 119 with a part selected under the fade, where it took 889 and 1612. A fade draws the lit items of a batch through a second index over the same buffers; an item inside its net's merged copper gets its own mesh only when first lit and is drawn over the merged copper from the frame it is lit, never a frame late at a wrong height; merged copper holding an item a live edit made stale turns see-through with it. Model files placed by their own matrix keep it.
