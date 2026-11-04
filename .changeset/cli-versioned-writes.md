---
'@pcbjs/cli': patch
'@pcbjs/lsp': patch
---

A session write to a file an editor holds carries the version of the text it was computed on, so the editor refuses it once its buffer moved on, as when typing lands during a drag. The write is reported as not applied with the reason, and the viewer's chip says `quad.pcb.tsx changed in the editor while the edit was made; nothing was written there`. An undo or redo from a page is checked the same way. A client that takes no versioned edits gets the plain form.
