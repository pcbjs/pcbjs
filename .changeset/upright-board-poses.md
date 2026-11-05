---
'@pcbjs/core': patch
'@pcbjs/compile': patch
'@pcbjs/export': patch
'@pcbjs/cli': patch
---

Support native board-reference poses with 3D translation and quaternion orientation. Preserve scalar rotation and flip, project tilted slabs, bodies and drills correctly, and expose transformed bounds and normals in reference inspection. Collision checks use conservative transformed prisms; referenced boards keep independent fabrication output.
