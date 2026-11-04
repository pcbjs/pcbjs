---
'@pcbjs/cli': patch
---

`pcbjs place --write`, `pcbjs patch hold` and `pcbjs model add --write` write through the live session when one serves the project, so an editor holding the file takes the change into its buffer instead of the disk changing under it; with no session they write the disk as before.
