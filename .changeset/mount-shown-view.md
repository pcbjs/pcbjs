---
'@pcbjs/ui': patch
---

A board page mounts only the view it shows, and the 2D view beside a split schematic, instead of keeping the 2D view alive under the 3D one: a 3D page or editor pane holds no 2D markup and runs one tool stack and one assist. The page asks the session for the facets of the views it mounts, and the 2D view comes back at the frame it was left at.
