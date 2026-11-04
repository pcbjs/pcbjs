---
'@pcbjs/ui': patch
---

Manual placement and routing in the 3D view: the move drag on the plane of the part's side with grid snapping, shift and the free modifier, the rotation ring in the board plane and `R`, the side flip, control point and leg handles on the route's layer, and the assist's dot field, lit grid, start marker, copper preview and findings chip on the chain's layer, all through the same `session/edit/*` calls as the 2D view so a drag writes the same text; the camera stays still during a drag. The key map lists the views each key acts in, and `F`, `+` and `-` fit and zoom the 3D view.
