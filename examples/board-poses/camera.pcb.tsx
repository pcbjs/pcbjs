import PCB, { defineFootprint, type FootprintProps } from '@pcbjs/core'
import { R0603, MountingHole } from '@pcbjs/lib'
import { twoLayer } from '@pcbjs/lib/stackups'
import { cameraSize, cameraThickness } from './dimensions'

const LensEnvelope = defineFootprint(
  function LensEnvelope({ children, ...rest }: FootprintProps) {
    return (
      <footprint id="Example:LensEnvelope" height={5} model={{ kind: 'ic', w: 6, h: 6, height: 5 }} bom={false} pos={false} {...rest}>
        <rect layer="F.Fab" x={-3} y={-3} w={6} h={6} />
        {children}
      </footprint>
    )
  },
  { pins: [], prefix: 'CAM' },
)

const CAM1 = LensEnvelope()
const R1 = R0603('1k')
const H1 = MountingHole(1)()
const H2 = MountingHole(1)()

export default (
  <PCB name="Camera" stackup={twoLayer({ thickness: cameraThickness })}>
    <rect layer="Edge.Cuts" x={-cameraSize / 2} y={-cameraSize / 2} w={cameraSize} h={cameraSize} />
    <CAM1 at="0 0" ref:at={false} />
    <R1 at="-6 0" />
    <H1 at="-7 -7" />
    <H2 at="7 7" />
  </PCB>
)
