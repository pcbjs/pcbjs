---
'@pcbjs/lsp': patch
---

Unit hints and tokens parse the file once instead of once per route chain call: about 4 ms instead of 130 ms per pass on a 600-line board.
