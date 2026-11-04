---
'@pcbjs/ui': patch
'@pcbjs/viewer': patch
---

The viewer's state is held by lifetime: a `Shell` per page from `createViewer`, with the route, theme, workspace, IDE and embed modes, agents, toasts and the command bus; a `BoardStore` per board, shared by every pane of it, with the board's facets, the data joined from them, what an edit made stale, the selection, the finding in focus, the hovers and the edit session; and a `PaneState` per pane, with its view, side, mirror, hidden layers, 3D look, tab and open rows. `useBoard` returns the board's `BoardStore`, so a `View3D` on a page of its own carries that board alone, and each panel reads the board and the pane it shows in through a composable of its own. `PcbViewer` takes `v-model:view`.
