---
title: Place readable reference labels
description: Position generated part references in each footprint's local frame.
---

# Place readable reference labels

Automatic reference placement is a useful starting point. A crowded row or a connector opening can need a deliberate label position. This lesson moves a generated reference without moving the component.

## Start with automatic labels

The compiler normally places a reference beside a part's courtyard while keeping clearance from nearby mask, silk and board edges. Inspect that result first. A placement includes both the footprint and its generated reference, so selecting a part highlights the two together.

For an explicit position, use `ref:at` on the placement:

```tsx {11,12} preview=advanced-reference-labels
import PCB, { nets } from '@pcbjs/core'
import { R0603, rect } from '@pcbjs/lib'

const { A, B } = nets()
const R1 = R0603('10k').connect({ 1: A, 2: B })
const R2 = R0603('10k').connect({ 1: A, 2: B })

export default (
  <PCB name="Labels">
    <path layer="Edge.Cuts" d={rect(24, 16)} />
    <R1 at="7 8" ref:at="0 -2 0" />
    <R2 at="16 8 90" ref:at="0 -2 0" />
  </PCB>
)
```

This placement-only exercise leaves the two nets unrouted, so `check` reports their unconnected copper. Focus on label clearance here; route both nets before treating it as a complete board.

The label coordinate belongs to the footprint frame. Both references have the same local offset; R2's rotated placement transforms that offset too. Back-side placement also mirrors the frame. The compiler keeps the resulting label upright for reading.

## Move the label deliberately

In the editor, put the cursor inside `ref:at` to focus the generated label itself. Change its local y offset from `-2` to `-3`, save and watch the label move while the pads remain fixed. Switch between front and back views when reviewing a back-side part.

Run `npx pcbjs check` after the change. An explicit position can still collide with other silk, a mask opening or the board edge; moving the label does not exempt it from checks.

## Hide only when appropriate

`ref:at={false}` disables one part's generated reference. `<PCB silkRefs={false}>` disables generated references for the whole board. Prefer a local choice when only one crowded part needs it, and keep a way to identify that part in assembly documentation.

You have now separated three decisions: where the component sits, where its reference is drawn, and whether that reference is generated at all. The [Layout reference](/docs/layout#silk-refs) covers placement defaults and exclusions; [Fonts](/docs/fonts) covers the text geometry.
