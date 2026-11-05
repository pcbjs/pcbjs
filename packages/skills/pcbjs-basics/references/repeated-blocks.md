# A channel row with named blocks

Parts made in a `.map` take their `ref` from the loop data; a `<g name>` around each block makes findings and `inspect` say `R3 (CH3/R3)`.

```tsx
import PCB from '@pcbjs/fab/JLCPCB/2-Layer'
import { nets, route } from '@pcbjs/core'
import { PinHeader, R0603, LED0603 } from '@pcbjs/lib'

const { VCC, GND } = nets()
const J1 = PinHeader(2)().connect({ 1: GND, 2: VCC })
const CH = [1, 2, 3, 4].map(i => {
  const { A } = nets(`CH${i}`)
  return { i, x: 4 + i * 6, R: R0603('330', { ref: `R${i}` }).connect({ 1: VCC, 2: A }), D: LED0603('red', { ref: `D${i}` }).connect({ A, K: GND }) }
})

export default (
  <PCB name="Row" rev="0.1.0">
    <rect layer="Edge.Cuts" x={0} y={0} w={36} h={14} />
    <J1 at="3 5.73" />
    {CH.map(({ i, x, R, D }) => (
      <g name={`CH${i}`}>
        <R at={`${x} 4`} />
        <D at={`${x} 9`} />
        {route(R[2], D.A)}
        {route(R[1], J1[2])}
        {route(D.K, J1[1])}
      </g>
    ))}
  </PCB>
)
```

A block with its own ports and private nets is a `circuit()`, see `pcbjs docs circuits`.
