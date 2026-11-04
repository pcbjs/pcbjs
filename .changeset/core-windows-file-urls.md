---
'@pcbjs/core': patch
---

On Windows, `file:` URLs given to `reference()`, a font entry or found in a stack frame become drive paths such as `C:/b/pcb.tsx` instead of `/C:/b/pcb.tsx`.
