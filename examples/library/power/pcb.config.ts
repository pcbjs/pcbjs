import { defineConfig } from '@pcbjs/core'

// A library: `pcbjs build --lib` writes dist/, the package of the modules below and of every board of entries, see library.md.
export default defineConfig({
  entries: ['pcb.tsx'],
  lib: { exports: { '.': './index.ts', './ldo': './ldo.tsx' } },
})
