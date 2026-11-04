---
'@pcbjs/ui': patch
---

The views draw a selection, a hover, an isolation and an edit from one `Paint`, applied as its difference from the last: in 3D a hover redraws the outline alone and a selection or an edit repaints only the items, parts and nets it changed, found through an index of the board's items built once per layers facet; in 2D the focus fade is one class on each layer group with the lit items drawn again beside their layer, and an isolation or an edit toggles classes only on the elements that changed. The 3D board is a `BoardScene` of three.js alone, apart from the component that holds the renderer and the camera.
