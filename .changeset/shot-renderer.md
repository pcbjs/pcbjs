---
'@pcbjs/cli': patch
---

`pcbjs shot` renders without a browser: 3D through `@pcbjs/renderer` from the board's GLB, 2D and the schematic from the exporter's SVG through sharp, by the one render spec of docs/render.md. New flags `--camera`, `--frame`, `--margin`, `--highlight`, `--dim`, `--opacity`, `--findings`, `--mark` and `--quality`; `--layer` repeated shows the layers together in one shot, `--side B` turns the 3D board over, `--mirror` and `--theme hc` apply to every view, the default size is 1280 by 960. Each PNG carries its snapshot and legend in `tEXt` chunks and the legend is printed beside it. With a live session the shots render in the session's renderer worker through `session/render`, which read-only connections may call; a trap or a worker exit is retried once on a fresh thread, a newer snapshot cancels an older one's shots. `pcbjs doctor` lists the renderer.
