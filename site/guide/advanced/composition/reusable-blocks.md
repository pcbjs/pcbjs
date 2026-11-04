---
title: Build reusable circuit blocks
description: Give a repeated circuit typed ports, private nets and a layout of its own.
---

# Build reusable circuit blocks

A repeated circuit needs both an electrical boundary and a physical arrangement. In this lesson you will create an LED channel with two ports, then place two independent instances of it.

Start from a project made with `pcbjs create`. Replace its board entry with this small exercise:

```tsx {11,12,13,14,25,26} preview=advanced-reusable-blocks
import PCB, { circuit, nets, route, type Ports } from '@pcbjs/core'
import { LED0603, R0603, rect } from '@pcbjs/lib'

const channel = circuit('channel', ({ VCC, GND }: Ports<'VCC' | 'GND'>, { nets: { led } }) => {
  const R = R0603('330').connect({ 1: VCC, 2: led })
  const D = LED0603('green').connect({ A: led, K: GND })
  return { R, D }
})

const ChannelRow = channel.layout((g, { at, side }) => (
  <g at={at} side={side}>
    <g.R at="-3.5 0" />
    <g.D at="3.5 0 180deg" />
    {route(g.R[2], g.D.A).width(0.3).Z()}
  </g>
), 'ChannelRow')

const { VCC, GND } = nets()
const CH1 = channel({ VCC, GND }, 'CH1')
const CH2 = channel({ VCC, GND }, 'CH2')

export default (
  <PCB name="Channels">
    <path layer="Edge.Cuts" d={rect(24, 18)} />
    <ChannelRow g={CH1} at="8.5 5" />
    <ChannelRow g={CH2} at="8.5 12" />
  </PCB>
)
```

## Follow the boundary

`VCC` and `GND` are the connections the caller supplies. `led` belongs to the circuit; CH1 and CH2 each get a separate internal net. Both channels share the same component definitions and arrangement, while their handles remain distinct: `CH1.R` and `CH2.R` name different resistors.

The layout receives the instance as `g`. Passing `at` and `side` into its outer `<g>` makes the whole channel movable, rotatable and reversible as one placement. Returning every part from the circuit makes its identity available to the layout and to inspection.

## Inspect the repeated design

Run `npx pcbjs dev`, select each channel and inspect its parts. The exercise routes only each resistor-to-LED connection: the supply and ground connections between channels still need board-level routing. Use the findings and ratsnest to identify that remaining work.

For a complete example, Blinky uses a related channel pattern three times. Explore its complete placement state below.

<GuideDemo example="blinky-groups" />

Change only CH2's `at` to `"18 12 90"`. Its resistor, LED and internal route should turn together, while CH1 stays in place. You now have a block whose electrical and physical reuse are explicit.

Continue with [instance layout overrides](./instance-layouts). The [Circuits reference](/docs/circuits) explains ports, naming, nested instances and multiple layouts.
