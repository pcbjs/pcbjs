# Grids

Named grids for placement: `defineGrid(name, { pitch, minor, origin, angle, frame })`, attached on `<PCB grid>` or `<g grid>`, so part and group positions under it are grid units; origins on pads and footprint points, a part's frame, schematic grids, and what the viewer snaps to.
Advanced. Read it to lay parts out on a pitch, such as a 2.54 mm header field or a rotated BGA escape, and to know what a drag in the viewer writes.

```tsx
import PCB, { defineGrid, nets } from '@pcbjs/core'
import { PinHeader, R0603 } from '@pcbjs/lib'

const { A, B, GND } = nets()
const J1 = PinHeader(4)().connect({ 1: A, 2: B, 3: GND, 4: GND })
const R1 = R0603('10k').connect({ 1: A, 2: B })
const R2 = R0603('10k').connect({ 1: B, 2: GND })

const field = defineGrid('field', { pitch: '100mil', minor: 2, origin: '5 5' })

export default (
  <PCB name="Gridded" rev="0.1.0">
    <J1 at="12 7" />
    <g name="Pulls" grid={field}>
      <R1 at="2 3 90" />
      <R2 at="3.5 3 90" />
    </g>
  </PCB>
)
```

`R1` sits two and three pitches from the origin, at 10.08 mm and 12.62 mm; `R2` uses the half step that `minor: 2` gives.

## defineGrid

| Option | Takes | Default |
| --- | --- | --- |
| `pitch` | mm, or a unit string such as `'100mil'` or `'1.27mm'` | required |
| `maxLevel` | maximum editing subdivision depth, integer 0 to 16; 0 means main pitch only | 2 |
| `minor` | a whole factor, or a list for recursive subdivision, `[2, 5]` halves then fifths of a half | none |
| `origin` | a coordinate in the frame the grid attaches in, mm or explicit units, never grid units; a pad handle; a footprint point; a function | `'0 0'` |
| `angle` | degrees, or `'0.5rad'` | 0 |
| `frame` | a part whose placed frame the grid adopts, its rotation and side with it | none |

The name is letters, digits, `_` and `-`, unique on a board: two grids of one name on a board are a compile error.

## Where a grid applies

- `<PCB grid={G}>` attaches it in the board frame; `<g grid={G}>` in the group's frame, after the group's own `at` and `side`.
- Under a grid, the bare numbers of a part's or a group's `at` are grid units: `origin + R(angle) · (x · pitch, y · pitch)` in the attaching frame. Explicit units keep their length, `at="10mm 2"` is 10 mm along the grid's x and two pitches along its y.
- A rotation in `at` turns from the grid's angle, so `at="1 0 0"` under a grid at 90 degrees is turned 90 degrees on the board.
- The grid in effect is the innermost on the ancestor chain. A `<g at>` under a grid moves the frame of what it holds, the grid's units with it.
- Routes, vias, pours, text and drawings under a grid stay in millimetres in their group's frame; a grid places parts and groups.
- `<PCB grids={[G, H]}>` lists grids no element attaches, so the viewer and `inspect --grids` know them.

## Origins

```tsx
import PCB, { defineGrid, defineFootprint, nets, type FootprintProps } from '@pcbjs/core'
import { R0603 } from '@pcbjs/lib'

const Bga = defineFootprint(
  function Bga(props: FootprintProps) {
    return (
      <footprint {...props}>
        <pad num="A1" at="-0.4 -0.4" size={0.3} type="smd" />
        <pad num="A2" at="0.4 -0.4" size={0.3} type="smd" />
      </footprint>
    )
  },
  { pins: ['A1', 'A2'] as const, prefix: 'U', points: { center: [0, 0] } },
)
const { A, B } = nets()
const U1 = Bga().connect({ A1: A, A2: B })
const R1 = R0603('1k').connect({ 1: A, 2: B })

const escape = defineGrid('escape', { pitch: 0.8, origin: U1.points.center, angle: 45 })

export default (
  <PCB name="Escape" rev="0.1.0">
    <U1 at="20 15 30" />
    <g grid={escape}>
      <R1 at="3 0" />
    </g>
  </PCB>
)
```

- A pad handle, `origin: U1.A1`, is the pad's centre where the board places it.
- A footprint point, `origin: U1.points.center`, comes from `defineFootprint(render, { points: { center: [0, 0] } })`, in the footprint frame in mm.
- A function, ``origin: r => `${r.part(U1).at[0]} 20` ``, reads `r.pad(handle)` and `r.part(part)` in the attaching frame and returns the origin.
- With `frame: U1`, as `defineGrid('local', { pitch: 1, frame: U1 })`, the grid adopts U1's placed frame, its rotation and mirror on side B, and its origin is in U1's frame. A `<g>` that attaches such a grid takes no `at` or `side`: the compile error `grid-frame`.
- An anchor part is read where the source places it, before automatic placement and patches.

## Cycles

A grid that reads a part is placed after that part, so the part must sit outside the grid. A part placed under the grid its origin or frame reads is the compile error `grid-cycle`, a diagnostic of kind `cycle` naming each member with its source, as `a grid cycle: U1 (pcb.tsx:9:5) → escape (pcb.tsx:4:16) → U1`. A grid whose anchor is placed later in the tree waits for it, so order in the file does not matter.

## The registry

The compile collects every grid an element attaches and every grid of `<PCB grids>` into the board model, never into a global: each with its name, pitch, subdivisions, board origin and angle, mirror, frame part, the `defineGrid` call and what is placed under it. `pcbjs inspect --grids` prints them; the viewer reads them from the board data.

```sh
pcbjs inspect --grids
```

## Schematic grids

`<Schematic grid>` takes a pitch in mm, as `grid={1.27}`, or a grid with only a pitch, as `grid={defineGrid('sch', { pitch: '50mil' })}`; its default is 100 mil. Schematic positions are always grid units. `<Sheet grid>` takes a grid whose pitch is a whole multiple of the schematic's, and the sheet's positions and hand wires are in its units. A schematic grid has no origin, angle or frame.

## In the viewer

- A selected part, group or instance under a grid shows that grid as dots through its own origin, at the first subdivision of `minor`, else the pitch, in 2D and 3D; with none the view shows its 1 and 10 mm grid and moves snap the placement origin to integer millimetres. A grid an editor hover lights is drawn as lines from its own origin.
- The Snap option starts checked only when the placement aligns with the selected grid or an allowed subdivision. Off-grid placements start unchecked. Manually enabling snapping uses pitch steps through the anchor, preserving its offset; shift lifts snapping, and cmd or ctrl keeps the move to one axis. Rotation stops are 15 degrees from the grid angle, 5 with shift; `R` turns 90 degrees.
- A snapped drag writes grid units with at most three decimals, `at="3 4.5"`; a free drag writes explicit millimetres, `at="7.623mm 10.16mm"`, so an off-grid part reads as one. editing.md has the tools.
- The editor shows each grid position's unit as an inlay hint, `3·⊞2.54mm`, with the grid's name on hover and a jump to its `defineGrid` on cmd+click; editor.md has the hints.

## Placement toolbar persistence

Changing the placement toolbar's grid writes `grid={{ snap: 0.25 }}` on the selected component. `snap` is a pitch in mm or a length string. It affects subsequent editing, without reinterpreting `at`, moving existing geometry or changing a group's internal layout. Parts, named groups, circuit layout instances and editable text support it. The regular source transaction provides undo and redo. If a props spread can supply or override `grid`, add an explicit `grid` attribute after that spread first; the toolbar refuses the ambiguous write rather than replacing a hidden coordinate grid.

For a group that already uses `grid={G}`, the edit preserves its coordinate grid as `grid={{ ...(G), snap: 0.25 }}`. Its children retain G's pitch, origin and angle. A part inside a shared layout gets an instance override; editing the library layout writes the shared definition.

Snap is checked when the existing placement lies on the chosen grid or an allowed subdivision, and unchecked otherwise. Matching uses the grid's origin, rotation and mirrored frame. The active editing step is at least as fine as the matched subdivision. Changing the grid resets a manual Snap choice; toggling Snap alone remains a view preference.

Set `maxLevel` in a named declaration, such as `defineGrid('field', { pitch: 2.54, minor: [2, 5], maxLevel: 2 })`, or on an individual placement, such as `grid={{ snap: 1, maxLevel: 0 }}`. Without an explicit limit, two subdivision levels are allowed. Each level uses the next `minor` factor; after those factors, it halves the previous pitch. Thus the default 1 mm grid accepts 1 mm, 0.5 mm and 0.25 mm positions. The limit bounds both automatic alignment detection and editing subdivisions.
