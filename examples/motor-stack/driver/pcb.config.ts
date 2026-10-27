import { defineConfig, defineDefaultBoard } from '@pcbjs/core'

// The driver: power nets run at 1.5 mm with 0.3 mm clearance on its 2 oz copper.
defineDefaultBoard({ classes: { power: { width: 1.5, clearance: 0.3 } } })

export default defineConfig({
  entries: ['pcb.tsx'],
})
