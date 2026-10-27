import { defineConfig } from '@pcbjs/core'

// The jig: no project defaults, so it must not pick up the controller's or the driver's net classes in a workspace server.
export default defineConfig({
  entries: ['pcb.tsx'],
})
