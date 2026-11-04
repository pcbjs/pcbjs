---
'@pcbjs/lsp': patch
'@pcbjs/cli': patch
---

The hover ends with the docs excerpt for the prop, element, call or builder method under the cursor: the table row, the paragraph or the paragraph under the heading of the topic that defines it, with a link to its page on pcbjs.dev. The excerpts come from a docs index the build writes into `dist/docs-index.json`, so a hover reads no file; `pcbjs docs --grep` searches the same index.
