---
'@pcbjs/cli': patch
---

A workspace session edits every project it serves: the viewer's tools, undo and redo read the shown project's root at each use instead of the first project's, so a move in any project writes that project's file rather than saying its placement is in no file of this project or writing the same path in the first project.
