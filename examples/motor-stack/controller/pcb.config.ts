import { defineConfig, defineDefaultBoard } from '@pcbjs/core'

// The controller: logic only, 1 oz copper from the JLCPCB preset; its power nets run at 0.4 mm.
defineDefaultBoard({ classes: { power: { width: 0.4 } } })

export default defineConfig({
  entries: ['pcb.tsx'],
})
