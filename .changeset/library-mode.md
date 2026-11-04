---
'@pcbjs/core': patch
'@pcbjs/compile': patch
'@pcbjs/export': patch
'@pcbjs/cli': patch
---

`pcbjs build --lib` publishes a project as an npm package into `dist`: the modules of the config's `lib.exports` as JavaScript with their types and source maps, the scope injection and binding capture applied, and every board of `entries` as data under `boards/<name>/`, its facets, reference data, mesh, GLB, posters and an `index.js` exporting its `BoardRef`. A module that makes a part when it loads fails the build naming it. `reference()` takes a package's board, `reference('@acme/power/boards/PowerModule', …)`, read from the package's `pcbjs` condition with no compile; reference data of another format names the package to rebuild. `compose()` of the new entry `@pcbjs/export/compose` places library boards against the first as `reference()` does and writes them as one GLB, each under `board:<name>`. `@pcbjs/export` also exports `boardGlb`, and `pcbjs doctor` lists the installed libraries with the core each was built with.
