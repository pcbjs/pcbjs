---
title: Move and rotate a local frame
description: Predict how group translation, rotation and back-side placement affect local coordinates.
---

# Move and rotate a local frame

Local coordinates let you position a block once, then move the block without rewriting every member. By the end of this lesson you will be able to predict a member's board position through a translated and rotated group.

## Start with one local offset

```tsx {10,11} preview=advanced-transforms
import PCB, { nets } from '@pcbjs/core'
import { R0603, rect } from '@pcbjs/lib'

const { A, B } = nets()
const R1 = R0603('10k').connect({ 1: A, 2: B })

export default (
  <PCB name="Frames">
    <path layer="Edge.Cuts" d={rect(32, 24)} />
    <g name="Block" at="15 12 90">
      <R1 at="4 0" />
    </g>
  </PCB>
)
```

This one-part coordinate exercise intentionally has single-pin nets, which the checks report. It demonstrates placement rather than a finished circuit.

Board coordinates have x to the right and y down. A positive rotation turns counter-clockwise on screen. R1's local point `4 0` turns to `0 -4`, then the group translation adds `15 12`, giving board position `15 8` mm.

| Group placement | Local point | Board point |
| --- | --- | --- |
| `15 12` | `4 0` | `19 12` |
| `15 12 90` | `4 0` | `15 8` |
| `20 12 90` | `4 0` | `20 8` |

Run `npx pcbjs inspect R1` after each change to confirm the absolute position. Notice that changing the group's translation moves the rotated result without changing the local offset.

## Put the block on the back

Add `side="B"` to the group. Its local x axis is mirrored before the rotation and translation. At `15 12 90`, the same local point `4 0` now lands at `15 16` mm. Inspect pin numbers and use the bottom view to check connector orientation, especially when parts mate through the board.

A grid attached inside the group follows this frame too. Bare placement coordinates under that grid are pitches; routes, drawings and text still use local millimetres. Keep those two unit systems distinct when moving a mixed block.

## Understand the rotation tool's centre

The viewer's compass turns a single ordinary placement about its origin. A group with its own attached grid uses that grid's resolved origin as its pivot; its placement transforms that origin onto the board. Multiple selected placements use the midpoint of their placement origins. The preview and source write use the same centre, and framing includes that centre so it remains reachable.

Your local coordinates now describe the block independently of its board position. See [Board coordinates](/docs/board#units-and-coordinates) for conventions, [Grids](/docs/grids) for grid frames, and [Editing](/docs/editing#gestures) for rotation gestures.
