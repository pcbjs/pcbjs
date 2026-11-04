---
'@pcbjs/cli': patch
'@pcbjs/lsp': patch
'@pcbjs/vscode': patch
'@pcbjs/ui': patch
'@pcbjs/viewer': patch
---

An edit that leaves its statement, JSX tag or JSX child with a syntax error, or with a type error once it parses, holds the compile while the cursor stays in that block: the board stays the last one that compiled until an edit leaves the block clean, the cursor leaves it, the file is saved or another block is edited, and a clean block never waits. The session logs the hold as a `compile` event `{ state: 'held', file, line }`, `session/state` and the viewer's heartbeat carry `hold`, the status bar and the viewer's header read `pcbjs: holding, pcb.tsx:42 has an error`, and a query through the session compiles the held draft as the repair makes it, `pcbjs check` saying so in a `held` line. The language server finds the block, `blockAt`, `changedBlock` and `blockError`, and type-checks it with `typeError`. docs/editor.md, Holding, has the rules.
