---
'@pcbjs/lsp': patch
---

The language server parses each document text once: hover, inlay hints, unit tokens, segments, the assist and the diagnostics of one version share one syntax tree and one line table, so a typing pause costs about 4 ms of parsing on a 600-line board instead of about 400 ms.
