import { circuit, nets, type Ports } from '@pcbjs/core'
import { R0603 } from '@pcbjs/lib'

const schematic = circuit('resistor', ({ A, B }: Ports<'A' | 'B'>) => ({ R: R0603('1k').connect({ 1: A, 2: B }) }))
const { A, B } = nets()
const instance = schematic({ A, B }, 1)
const Layout = schematic.layout((g, { at }) => <g at={at}><g.R at="0 0" /></g>)
const InstanceLayout = instance.layout((g, { at }) => {
  g.R[1]
  g.ports.A
  // @ts-expect-error Unknown members remain type errors.
  g.missing
  // @ts-expect-error Unknown ports remain type errors.
  g.ports.missing
  return <g at={at}><g.R at="0 0" /></g>
})
schematic.layout(g => {
  // @ts-expect-error Definition methods retain member types too.
  g.missing
  return <g.R />
}, 'Variant')
// @ts-expect-error A render callback is required.
schematic.layout()
// @ts-expect-error Instances still need the g prop when placed.
const missingInstance = <InstanceLayout />
export const placed = <g><Layout g={instance} /><InstanceLayout g={instance} /></g>
