---
"@pcbjs/viewer": patch
---

First beta. The Vue site that shows boards in 2D, 3D with an exploded stack and focus mode, and the schematic, with findings, nets, differential pairs as one object and the BOM. The dev server serves it from source, and `pcbjs build` prerenders it.

A click on a pour, in 2D or 3D, opens its `pour()` call or `<zone>` element in the editor.
