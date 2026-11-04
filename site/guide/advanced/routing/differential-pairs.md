---
title: Route a differential pair
description: Keep positive and negative signals together with a shared centre line.
---

# Route a differential pair

Two related signals need more than two independent routes when their geometry must stay coupled. This lesson routes a positive and negative signal together, then inspects width, gap and skew as distinct constraints.

## Declare both endpoints in the same order

```tsx {14} preview=advanced-differential-pairs
import PCB from '@pcbjs/fab/JLCPCB/4-Layer'
import { nets, route } from '@pcbjs/core'
import { PinHeader, rect } from '@pcbjs/lib'

const { DP, DN } = nets({ DP: { class: 'data' }, DN: { class: 'data' } })
const J1 = PinHeader(2)().connect({ 1: DP, 2: DN })
const J2 = PinHeader(2)().connect({ 1: DP, 2: DN })

export default (
  <PCB name="PairPractice" classes={{ data: { gap: 0.2, skew: 0.1 } }}>
    <path layer="Edge.Cuts" d={rect(36, 22)} />
    <J1 at="5 9" />
    <J2 at="30 9" />
    {route([J1[1], J1[2]], [J2[1], J2[2]]).width(0.25)}
  </PCB>
)
```

Both arrays use `[P, N]` order. The chain describes one centre line; the compiler lays out one track on each side. Here each track is 0.25 mm wide and the requested edge-to-edge gap is 0.2 mm. The connector pads are farther apart than the coupled tracks, so inspect the fans at the ends as well as the central run.

The wide connector pitch also makes this exercise report `pair-uncoupled`: its end fans exceed the default 5 mm uncoupled limit. Inspect those fans and compare the intended interface's requirements before changing that limit. A clean central run alone does not establish a valid pair.

## Change one constraint at a time

Move J2 down by 4 mm and inspect the bends. Compare the pair's two lengths with `npx pcbjs inspect --lengths`. Skew is their length difference; gap is their separation. A pair can satisfy one and fail the other.

Add `.H(18).X()` to the pair route if you want to constrain its centre line before automatic completion. A `.via('B.Cu')` in a suitable chain changes both tracks through a via pair; allow physical room for the wider via spacing and the flare back into the coupled run.

## Introduce impedance with a real stackup

The four-layer preset provides stackup information. Replacing `.width(0.25)` with `.impedance(90)` asks the solver for a differential width while keeping the class gap. Treat that value as a stackup-dependent design constraint, then review the solved geometry against the intended fabrication stack.

Use the [highspeed example](/examples/highspeed) to study a complete connector, ESD array and pair of layer transitions. It is a better next step than treating this connector-only exercise as a ready USB design.

You now have one route object that owns the pair's geometry. The [Differential pairs reference](/docs/pairs) covers fans, crossover, vias and pair-specific findings. Continue with [length matching](./length-matching) to compare length targets and match groups.
