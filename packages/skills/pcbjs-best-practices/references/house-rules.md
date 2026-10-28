# House rules over every fab

A project ordered from more than one fab, or with an owner's rule sheet, keeps one rule module. It raises every minimum to the largest of the owner's value, each fab's published value and the board's own, so every board is checked against the strictest of them on every compile.

```ts file=house.ts
import type { Rules } from '@pcbjs/core'
import { ADVANCEDPCB, JLCPCB } from '@pcbjs/lib/rules'

// the owner's rule sheet, mm
const HOUSE: Partial<Rules> = { clearance: 0.2, minTrackWidth: 0.15, silkMinWidth: 0.15, edgeClearance: 0.4, maskWeb: 0.13 }
const FABS = [JLCPCB, ADVANCEDPCB]
const MINIMA = ['clearance', 'minTrackWidth', 'edgeClearance', 'minDrill', 'minViaDrill', 'minViaDiameter', 'minAnnularRing', 'minPadAnnularRing', 'silkMinWidth'] as const

const largest = (values: unknown[]) => Math.max(0, ...values.filter((v): v is number => typeof v === 'number'))

export function houseRules(board: Partial<Rules> = {}): Partial<Rules> {
  const out: Partial<Rules> = { ...HOUSE, ...board }
  for (const k of MINIMA) out[k] = largest([HOUSE[k], board[k], ...FABS.map(f => f[k])])
  return out
}
```

```tsx file=pcb.tsx
import PCB from '@pcbjs/fab/JLCPCB/2-Layer'
import { houseRules } from './house'

export default (
  <PCB name="Housed" rules={houseRules({ clearance: 0.25 })}>
    <rect layer="Edge.Cuts" x={0} y={0} w={20} h={20} />
  </PCB>
)
```

- Sided and kind-split rules, `holeClearance: { inner, outer }` and `minHoleToHole: { pad, via }`, are objects: set them in `HOUSE` per side rather than taking a plain maximum, since a fab's pad hole spacing taken as one number flags vias of one net the fab allows much closer.
- A board's `rules` merge key by key over the preset's, so the module returns only what it sets.
- Record per board what the maximum raised: silk width, ring, hole spacing. Those are rules the old files did not hold.
- With `variants(...)`, targets with the same copper count share one routing under the strictest of their rules, so the house set and the fab sets are routed once, see `pcbjs docs fab`.
