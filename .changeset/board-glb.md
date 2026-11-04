---
'@pcbjs/export': patch
'@pcbjs/cli': patch
'@pcbjs/compile': patch
'@pcbjs/viewer': patch
---

Every compile exports the board as one GLB beside the board SVG and a schematic SVG: metres with y up, a node per stack group in the exploded view's order, `copper:<layer>` merged per net with each item's selection geometry kept by uid, `part:<ref>` and `reference:<name>`, explode vectors in the node extras, and the board faces rasterised through sharp. `pcbjs build` writes it as `boards/<name>.glb`. The exports stage stores binary outputs as objects of their own and keys on an exporter's file inputs, such as model meshes. The GLB and the viewer share one 3D scene geometry.
