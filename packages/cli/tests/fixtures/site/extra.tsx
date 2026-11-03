// A board that is no entry of the config: a facet import compiles it all the same, with the project's config and defaults.
import PCB from '@pcbjs/fab/JLCPCB/2-Layer'
import { nets } from '@pcbjs/core'
import { R0603, roundedRect } from '@pcbjs/lib'

const { A, B } = nets()
const R1 = R0603('10k').connect({ 1: A, 2: B })

export default (
  <PCB name="Extra" rev="0.1.0">
    <path layer="Edge.Cuts" d={roundedRect(10, 8, 1)} />
    <R1 at="5 4" />
  </PCB>
)
