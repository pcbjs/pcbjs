# A config for several boards

```ts file=pcb.config.ts
import { defineConfig, defineDefaultBoard } from '@pcbjs/core'
import { JLCPCB } from '@pcbjs/lib/rules'

defineDefaultBoard({ rules: JLCPCB })

export default defineConfig({
  entries: ['boards/*.tsx'],
  kicad: { footprints: ['lib/footprints'] },
})
```

`defineDefaultBoard` is process-wide, so call it only in the config or a module every entry imports. A board's own `rules` merge over its rules key by key.

When adding another board to an existing project, default to a sibling entry in this config and the existing session. Add its filename to `entries` or use the existing glob, then check that both entries are selectable with `pcbjs inspect <entry>`. Do not scaffold a nested package, config or dev-port script unless the owner requests an independent project or dependencies/configuration actually require isolation.
