---
'@pcbjs/compile': patch
'@pcbjs/cli': patch
'@pcbjs/core': patch
---

The compile runs as a graph of twelve stages, evaluate, place, schematic, manualCopper, autoroute, placeFollowers, routeFollowers, tune, patches, finish, checks and exports. Plugins registered in `defineConfig({ plugins })` and `<PCB plugins>` add stages before routing and before the checks, before and after hooks on every stage, and checks; `definePlugin` types one. `compileStages` returns each target's board, exports and stage times, runs only the stages the views in `want` need, and stops with `CancelledError` when its `signal` is aborted. `pcbjs check --verbose` prints a line per stage with its time.
