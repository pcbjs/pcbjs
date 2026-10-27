# Fab output

The fab set should explain itself to the fab and rebuild byte for byte. `pcbjs docs fab` and `pcbjs docs fab-set` have every file.

## Notes, teardrops and text

```tsx
import PCB from '@pcbjs/fab/JLCPCB/2-Layer'
import { nets, route } from '@pcbjs/core'
import { PinHeader } from '@pcbjs/lib'

const { A, B } = nets()
const J1 = PinHeader(2).connect(A, B)
const J2 = PinHeader(2).connect(A, B)
const LABEL = { size: 1.25, width: 1.35, thickness: 0.21, font: 'newstroke' } as const
const stamp = `V1.2.0 | ${process.env.GIT_SHORT || 'DEV'}`

export default (
  <PCB
    name="Notes"
    color="black"
    fabNotes={['Single board, no panel.', 'Remove the order number.']}
    teardrops={{ pads: 'tht' }}
    fonts={{ slab: './fonts/RobotoSlab-Bold.ttf' }}
  >
    <rect layer="Edge.Cuts" x={0} y={0} w={30} h={15} />
    <J1 at="3 5" />
    <J2 at="27 5" />
    {route(J1[1]).Z(J2[1]).width(0.4)}
    {route(J1[2]).Z(J2[2]).width(0.4)}
    <text layer="F.SilkS" at="15 10" {...LABEL}>IN</text>
    <text layer="F.SilkS" at="15 13" size={1.2} font="slab" thicken>{stamp}</text>
  </PCB>
)
```

- `fabNotes` puts order form choices into README-fab's Notes, joined from the defaults, the preset or variant target, then `<PCB>`. A side file next to the zip is one more thing to forget.
- `teardrops={{ pads: 'tht' }}` strengthens joints where drill registration and rework matter and leaves SMD lands as drawn. A blocked one shrinks or is dropped with an info finding.
- `font: 'newstroke'` with KiCad's `size`, `width` and `thickness` draws KiCad's own glyphs, for legends an owner already approved in KiCad.
- An outline font stroke can fall under `silkMinWidth` for some characters only: `thicken` grows it by the deficit. Text that changes per build, a hash, a date, a serial, must be checked with every character it can hold, such as `GIT_SHORT=FFFFFFF`, since a clean check at one commit proves nothing for the next.
- An outline font ships with its licence beside it; README-fab names every font the board uses.
- Sign the board with the pcbjs logo, `<Brand>` of `@pcbjs/lib`, where it does not crowd labels or refs: a free silk corner, the back when the front is full, 4 to 6 mm high on a small board, never below the height its compile error names. Never add it to a customer's own branded board without asking.

## Notes per fab with variants

```tsx
import { variants } from '@pcbjs/core'
import { bindPCB } from '@pcbjs/fab'
import JLCPCB from '@pcbjs/fab/JLCPCB/2-Layer'
import AdvancedPCB from '@pcbjs/fab/AdvancedPCB/2-Layer'

const Jlc = bindPCB({ ...JLCPCB.preset, finishes: [...JLCPCB.preset.finishes], fabNotes: ['Black mask, ENIG.'] })
const Adv = bindPCB({ ...AdvancedPCB.preset, finishes: [...AdvancedPCB.preset.finishes], fabNotes: ['Standard spec.'] })
const PCB = variants(Jlc, Adv)

export default (
  <PCB name="Both">
    <rect layer="Edge.Cuts" x={0} y={0} w={20} h={20} />
  </PCB>
)
```

Both targets share one routing under the stricter rules, and each gets its own fab set and README-fab.

## Reproducible fab sets

Every dated file takes `pcbjs build --date <iso>`, else `SOURCE_DATE_EPOCH`. Stamp the last commit that touched the design, not the last commit, so committing the fab set does not change its own stamp:

```make
fab:
	SOURCE_DATE_EPOCH=$$(git log -1 --format=%ct -- pcb.tsx pcb.config.ts lib models package.json) npx pcbjs build -q
```

Two builds of one tree, cold and warm, then give the same zip hash. Keep anything you add next to the set, such as an order note, outside the paths in the `git log`.
