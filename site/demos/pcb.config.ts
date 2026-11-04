import { defineConfig, defineDefaultBoard } from '@pcbjs/core'
import { JLCPCB } from '@pcbjs/lib/rules'

defineDefaultBoard({ rules: JLCPCB })

export default defineConfig({
  entries: ['route.pcb.tsx', 'pour.pcb.tsx', 'drc.pcb.tsx', 'divider.pcb.tsx'],
})
