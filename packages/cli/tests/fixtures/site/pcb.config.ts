import { defineConfig } from '@pcbjs/core'

// the board of the facet import tests; sch.tsx is no entry, which a facet import compiles all the same
export default defineConfig({ entries: ['pcb.tsx'] })
