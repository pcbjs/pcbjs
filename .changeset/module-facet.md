---
'@pcbjs/cli': patch
'@pcbjs/compile': patch
---

`?pcb:module` imports a board as the `BrowserModule` of `@pcbjs/compile/browser`: the config and design bundled for the browser with esbuild and `keepNames`, the CLI's scope and source range transforms applied, with the project's files, the route memo, its references and the facet hashes of the Node compile. `pcbjs({ boards: 'compile' })` makes `?pcb:board` in a build ship the poster and that module instead of the facet files, the page compiling the board in a worker on load. The browser compile checks `expect` with `checkHash`, a facet's hash without the router's own counts, so a warm browser compile agrees with a cold Node one.
