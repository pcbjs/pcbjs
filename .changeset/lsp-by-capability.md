---
'@pcbjs/lsp': patch
'@pcbjs/cli': patch
---

The language server reads the compiled boards once per set of boards: a file's ranges, routes, findings and parts are computed on the first request and shared by every later request and connection until a compile changes a board, so inlay hints on a 600-line board take about 0.5 ms instead of about 6 ms. Each capability is its own module, and the server is started with a `Host`: a `BoardSource` it reads, with the boards, placements, shadowed files and skipped spans, and the `EditorEvents` it emits, with focus, cursor, selection, assist, completion focus, grid and close.
