---
'@pcbjs/cli': patch
'@pcbjs/lsp': patch
---

Add read-write preview transactions for placement, rotation, side and routing edits. Commits update one source document through its owning editor, or disk when no editor is attached, and reject changed literals or multi-document writes. Shared or external automatic routes can use reroute patches; unsupported automatic or shared placement literals are refused.
