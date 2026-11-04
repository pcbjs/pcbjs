---
'@pcbjs/compile': patch
'@pcbjs/kicad': patch
'@pcbjs/cli': patch
---

`scopeHost(options, root, read)` reads a file's text ahead of the disk, and `typecheck(root, entries, { overlay })` type-checks unsaved editor text without reading or writing `.pcbjs/typecheck.json`. `compileStages` starts a newer schematic epoch before its first stage, so a module evaluated for a compile that ended before `place`, by an error or a cancel, drops its old parts on its next evaluation. The route memos live under `CompileOptions.cache.dir`, in memory when it is null, and a project's footprint folders come from `setKicadConfig`, which the cli calls for every project.
