---
'@pcbjs/cli': patch
'@pcbjs/lsp': patch
'@pcbjs/ui': patch
'@pcbjs/vscode': patch
'@pcbjs/viewer': patch
---

A click in a preview pane puts the editor cursor on the `at` value of what it selected and reveals it while focus stays in the pane: the PCB placement from 2D and 3D, the symbol's placement inside `<Schematic>` from the schematic, the declaration of a net or of what has no placement in that view; the chip's Open placement follows its view; `pcbjs/select` gains `focus`, which the chip's Open placement and Open definition send so the editor takes focus. Cmd or ctrl+Z in a view undoes the last edit made from it and cmd or ctrl+shift+Z redoes it: in a VS Code pane by the editor's own undo on the document the edit went through, elsewhere through the session, which keeps an edit history per client with `session/edit/undo` and `session/edit/redo`, refusing when the file changed since. The chip shows an undo arrow after an edit.
