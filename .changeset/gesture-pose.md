---
'@pcbjs/ui': patch
---

A drag or a ring turn is one `Pose` from the gesture model, which each view draws: the 2D view moves its own elements through its element index, and the 3D view moves the bodies and draws the pads, routes, vias and texts of the dragged part or instance again where they go, so an instance's routes and texts follow a 3D drag as they do in 2D. After the drop the pose holds per facet until the facet that draws the result arrives, in both views alike.
