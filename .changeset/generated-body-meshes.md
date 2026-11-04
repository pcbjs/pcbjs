---
'@pcbjs/core': patch
'@pcbjs/export': patch
'@pcbjs/ui': patch
'@pcbjs/cli': patch
---

A generated part body is mesh data under a hash, as a model file is. `modelMeshes(spec, ctx)` in `@pcbjs/ui/models` builds it in Node or the browser, the model facet names its hash as the footprint's `mesh`, from `modelHash` and `MODELS_VERSION` in `@pcbjs/export`, and the CLI makes it on first ask into `.pcbjs/models/<hash>.bin` and the user model cache. The board GLB, `pcbjs shot` and referenced boards draw these meshes, so a header, an LED lens, a SOT-23 or a chip looks there as it does in the 3D view, which draws the same meshes and adds a resistor's printed code; only a part without a model is a body box.
