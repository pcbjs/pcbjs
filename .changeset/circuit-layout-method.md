---
'@pcbjs/core': patch
'@pcbjs/lsp': patch
'@pcbjs/cli': patch
---

Add typed layout(render, name?) methods to circuit definitions and instances, equivalent to the standalone layout factory. Preserve source focus for method declarations and use the method form in the Blinky starter. The name layout is now reserved for this method on circuit instances.
