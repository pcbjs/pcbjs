---
'@pcbjs/core': patch
'@pcbjs/compile': patch
'@pcbjs/export': patch
'@pcbjs/ui': patch
'@pcbjs/cli': patch
'@pcbjs/lsp': patch
---

Track source definition identities and nested instance frames in schematic and edit metadata. Definitions with matching names in different files remain distinct, shared edits resolve the correct affected instances, and nested isolation follows its own frame and parent.
