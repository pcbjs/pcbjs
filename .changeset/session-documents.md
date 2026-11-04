---
'@pcbjs/cli': patch
'@pcbjs/lsp': patch
---

The session holds one document store for every language server: the editor that synced a file holds it, an agent syncs only a file no editor holds and is told once, and a disk write under an editor's unsaved text stays shadowed with a warning on the file. The compile and tsc read the store. Each project compiles in a worker thread of its own, cancelled within one unit by an edit and restarted once after a crash. A full compile commits a snapshot `<session>.<run>`; queries settle first and answer in an envelope with its id, `stale` and the unsaved files, through `session/check`, `session/resolve`, which follows an old reference by lineage, and `session/events`. Every frame carries `seq`, and `session/state` beats every 5 s and after each snapshot. A project's realm holds its defaults, KiCad config, model resolver and source mapper during its config load and compiles. Source writes go through `workspace/applyEdit` while an editor is attached.
