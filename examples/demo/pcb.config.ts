import { defineConfig, defineDefaultRules } from '@pcbjs/core'
import { JLCPCB } from '@pcbjs/lib/rules'

// Project-wide default rules: every board starts from JLCPCB's rule set, and a board's own `rules` win key by key.
// They live here, not in a module one entry imports, because the defaults are process-wide: a module imported by
// one entry would also change every board compiled after it.
defineDefaultRules(JLCPCB)

export default defineConfig({
  entries: ['blinky.pcb.tsx', 'coin.pcb.tsx', 'quad.pcb.tsx', 'multi.pcb.tsx'], // the boards; every pcbjs command reads them, globs such as 'boards/*.tsx' allowed
})
