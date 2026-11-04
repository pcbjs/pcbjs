---
'@pcbjs/cli': patch
---

The session's compile thread keeps each board's GLB, fab set and drawings and hands them over only when a render, a fab download, an SVG or `pcbjs test` asks, and it sends a board and its site data only when they changed since its last answer, with the facet hashes it computed once. A warm compile of usb3-hub whose stages all hit now blocks the session's main thread for about 1 ms instead of about 65 ms and carries a few kB instead of 32.6 MB, and the module graph crosses only when it moved.
