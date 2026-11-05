# Fab output

The fab set should contain the instructions needed to manufacture the board and rebuild byte for byte. `pcbjs docs fab` and `pcbjs docs fab-set` have every file.

## Markings and notes

Treat silkscreen as the physical board's interface. Add text when it helps someone assemble, connect, test or identify that board, or when the owner requests it. A draft status discussed in chat is not a reason to print warnings on either side.

| Information | Destination |
| --- | --- |
| Reference, polarity, connector function, voltage, orientation, board identity/revision | Concise silkscreen near the relevant feature |
| Actionable order instruction, such as no panelization or removal of the fab's order number | `fabNotes`, which writes README-fab, not silkscreen |
| Unresolved design choice, provisional dimension, qualification evidence | Existing project notes, only when needed for future work |
| Work completed, verification result, material limitation already discussed | Concise chat update; repeat only when it changes the next decision |

Do not add generic “not for fabrication,” “unverified,” TODO or review-status markings by default. Preserve owner-requested markings and physical-use warnings where justified. Do not relocate the same disclaimer dump to `Dwgs.User`, `fabNotes`, comments or a new report. Keep durable decisions in one existing place and refer to them briefly. Already generated stackup, finish and check results do not need prose duplicates in `fabNotes`.

## Notes, teardrops and text

```tsx
import PCB from '@pcbjs/fab/JLCPCB/2-Layer'
import { nets, route } from '@pcbjs/core'
import { PinHeader } from '@pcbjs/lib'

const { A, B } = nets()
const J1 = PinHeader(2)().connect({ 1: A, 2: B })
const J2 = PinHeader(2)().connect({ 1: A, 2: B })
const LABEL = { size: 1.25, width: 1.35, thickness: 0.21, font: 'newstroke' } as const
const revision = '0.1.0'

export default (
  <PCB
    name="Notes"
    rev={revision}
    color="black"
    fabNotes={['Single board, no panel.', 'Remove the order number.']}
    teardrops={{ pads: 'tht' }}
    fonts={{ slab: { file: './fonts/RobotoSlab-Bold.ttf' } }}
  >
    <rect layer="Edge.Cuts" x={0} y={0} w={30} h={15} />
    <J1 at="3 5" />
    <J2 at="27 5" />
    {route(J1[1], J2[1]).width(0.4).Z()}
    {route(J1[2], J2[2]).width(0.4).Z()}
    <text layer="F.SilkS" at="15 10" {...LABEL}>IN</text>
    <text layer="F.SilkS" at="15 13" size={1.2} font="slab" thicken>REV {revision}</text>
  </PCB>
)
```

- `fabNotes` puts actionable order instructions into README-fab's Notes, joined from the defaults, the preset or variant target, then `<PCB>`. Leave it unset when there is nothing additional for the fabricator to do.
- `teardrops={{ pads: 'tht' }}` strengthens joints where drill registration and rework matter and leaves SMD lands as drawn. A blocked one shrinks or is dropped with an info finding.
- `font: 'newstroke'` with KiCad's `size`, `width` and `thickness` draws KiCad's own glyphs, for legends an owner already approved in KiCad.
- An outline font stroke can fall under `silkMinWidth` for some characters only: `thicken` grows it by the deficit. Text that changes per build, a hash, a date, a serial, must be checked with every character it can hold, such as `GIT_SHORT=FFFFFFF`, since a clean check at one commit proves nothing for the next.
- An outline font ships with its licence beside it; README-fab names every font the board uses.
- When the owner requests pcbjs branding, use `<Brand>` of `@pcbjs/lib` without crowding labels or refs and respect its minimum size. Do not add branding by default.

## Notes per fab with variants

```tsx
import { variants } from '@pcbjs/core'
import { bindPCB } from '@pcbjs/fab'
import JLCPCB from '@pcbjs/fab/JLCPCB/2-Layer'
import AdvancedPCB from '@pcbjs/fab/AdvancedPCB/2-Layer'

const Jlc = bindPCB({ ...JLCPCB.preset, finishes: [...JLCPCB.preset.finishes], fabNotes: ['Remove the order number.'] })
const Adv = bindPCB({ ...AdvancedPCB.preset, finishes: [...AdvancedPCB.preset.finishes] })
const PCB = variants(Jlc, Adv)

export default (
  <PCB name="Both" rev="0.1.0">
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
