---
'@pcbjs/cli': patch
---

`pcbjs()` from `@pcbjs/cli/vite` is the Vite plugin of the `?pcb:` imports: `import layers from './pcb.tsx?pcb:layers'` gives a board module's `meta`, `sch`, `layers`, `shapes`, `model`, `findings` or `fab` facet as data, `?pcb:board` a ref for the components of `@pcbjs/ui`, `?pcb:poster` the board's SVG, `&target=` a variant. A worker thread per project compiles as `pcbjs check` does, sharing its cache, or in dev the live session serving the project answers through the new `session/facets`; an edit to a file the board read updates its facet modules. `resolveBoard()` gives the same facets in Node and `@pcbjs/cli/client` types the imports.
