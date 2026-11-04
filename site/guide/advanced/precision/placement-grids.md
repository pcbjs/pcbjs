---
title: Place parts on a named grid
description: Work in connector pitches while keeping the board coordinates explicit.
---

# Place parts on a named grid

A pitch-based arrangement is easier to maintain in grid units than in repeated decimal millimetres. This lesson puts two parts on a 2.54 mm field and shows how explicit units let one coordinate depart from that field.

## Attach a grid to one group

```tsx {12,13,14} preview=advanced-placement-grids
import PCB, { defineGrid, nets } from '@pcbjs/core'
import { R0603, rect } from '@pcbjs/lib'

const { A, B } = nets()
const R1 = R0603('10k').connect({ 1: A, 2: B })
const R2 = R0603('10k').connect({ 1: A, 2: B })
const field = defineGrid('field', { pitch: '100mil', minor: 2, maxLevel: 2, origin: '5 5' })

export default (
  <PCB name="GridPractice">
    <path layer="Edge.Cuts" d={rect(30, 24)} />
    <g name="Field" grid={field}>
      <R1 at="2 3" />
      <R2 at="3.5 3" />
    </g>
  </PCB>
)
```

This exercise places parts without routing their shared nets, so `check` reports two unconnected nets. Use it to inspect positions; complete the electrical connections separately.

The grid origin is `5 5` mm in the group's frame. One pitch is 2.54 mm, so R1's board position is `10.08 12.62` mm. R2 sits half a pitch beyond the third column: `minor: 2` provides that subdivision for editing.

<svg viewBox="0 0 360 110" role="img" aria-label="A grid origin at 5,5 followed by two grid pitches to R1 along x" style="width:100%;max-width:560px;color:var(--vp-c-text-1)">
  <path d="M35 35H315M35 35V90M105 25V90M175 25V90M245 25V90M315 25V90" fill="none" stroke="currentColor" opacity=".3" />
  <circle cx="35" cy="35" r="4" fill="currentColor" /><circle cx="175" cy="35" r="5" fill="#3b82f6" />
  <g fill="currentColor" font-size="12" text-anchor="middle"><text x="42" y="17">origin</text><text x="105" y="106">1 pitch</text><text x="175" y="17">R1: x = 2</text><text x="245" y="106">3 pitches</text></g>
</svg>

The diagram shows only the x coordinate; R1 is also three pitches down the y axis.

## Step outside the lattice

Change R2's position to `at="10mm 3"`. Its local x is now an explicit 10 mm, while y remains three pitches. Explicit units change the length interpretation; they do not remove the grid's origin or frame.

Use `npx pcbjs inspect --grids` to inspect the resolved field. Select R1 in the viewer to see the grid dots used for movement. Under this explicit grid, drag steps are relative to the part's starting origin, so an off-grid placement retains its offset. Shift moves freely. Without an explicit grid, movement snaps to integer board millimetres.

The placement toolbar writes its snapping pitch back to the component's `grid` attribute while preserving its position and coordinate frame. Snap is checked only when the current position lies on that grid or an allowed subdivision. `maxLevel` bounds the subdivision depth; it defaults to two when omitted. Grid dots stay subdued beneath the focused layer.

## Anchor the next field

Once the fixed-origin exercise is clear, try a grid whose origin is a placed pad or whose `frame` is a placed part. Keep the anchor outside the grid that reads it: placing an anchor under its own dependent grid creates a cycle.

Continue with [transforms and local frames](./transforms). The [Grids reference](/docs/grids) covers pad origins, frame adoption and subdivisions.
