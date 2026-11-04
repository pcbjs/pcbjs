---
'@pcbjs/viewer': patch
---

The 2D view has the editing tools for the selection's anchor in dev: Move, a rotation ring dragged in 15 degree stops and 5 with shift, `R` for a quarter turn, the side as F or B, and control points and automatic leg handles for a route. A drag previews at once and writes once through the session; shift snaps one subdivision finer, cmd or ctrl lifts snapping, a control point takes a pad centre or a point of its net within 8 pixels before the grid, and the grid an entity is placed on is drawn while it is selected. The toolbar names where a drag writes, says when no editor is attached, and is disabled on a read-only session and hidden in a built site and an embed; cmd or ctrl+Z in an editor pane undoes the last write in the editor.
