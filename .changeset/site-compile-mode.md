---
'@pcbjs/cli': patch
'@pcbjs/compile': patch
'@pcbjs/ui': patch
---

`pcbjs({ boards: 'compile' })` compiles a board in the page when a view first wants it, not when its module loads, and ships less: the design modules of a project built once and minified, the pcbjs packages once under `pcb/lib/` for every project, no pictures or archives as project files, the route memo without indentation, the board's poster alone. A build writes each STEP model's mesh once as `models/<hash>.bin` in either mode, and the browser compile finds a model's mesh and a fetched model as Node did. Posters are the top view at 0.01 mm without metadata or item ids, and an SSR build writes their URLs under the base. A view shows its poster until the board's facets are there and keeps it when the compile fails; `PcbViewer` fetches what a view switched to later shows. A board with variants compiles its first target through `resolveBoard()` and the data facets, as `?pcb:board` does. A design reading `process.env` in the browser reads an empty environment.
