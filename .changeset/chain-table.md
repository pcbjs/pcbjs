---
'@pcbjs/core': patch
'@pcbjs/cli': patch
'@pcbjs/lsp': patch
---

A pair's `.cross(layer)` is a chain command like `.via(layer)`: it gets a source range of its own, the editor offers its layers, and a hover lights only it. A frame of any pcbjs package, the KiCad importer and the language server included, is never taken for the author's call site.
