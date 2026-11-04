---
'@pcbjs/lsp': patch
---

Protocol 3: `pcbjs/focus` carries every editor selection and the server resolves each to the entities its code made, the primary cursor's the anchor; `pcbjs/select` sends one range per selected member, grouped by file, with the primary and whether to reveal it.
