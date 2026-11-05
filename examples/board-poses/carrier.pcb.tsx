import PCB, { reference, type ReferencePose } from '@pcbjs/core'
import { twoLayer } from '@pcbjs/lib/stackups'
import { carrierThickness, opticalHeight } from './dimensions'

const orientation: ReferencePose['orientation'] = [Math.SQRT1_2, 0, 0, Math.SQRT1_2]
const anchors = [
  [10, 0],
  [110, 0],
  [60, 62],
]

export default (
  <PCB name="Carrier" stackup={twoLayer({ thickness: carrierThickness })}>
    <rect layer="Edge.Cuts" x={0} y={0} w={120} h={80} />
    {anchors.map(([x, y]) =>
      reference('./camera.pcb.tsx', {
        pose: { translation: [x, -y, carrierThickness + opticalHeight], orientation },
        show: { opacity: 0.7 },
      }),
    )}
  </PCB>
)
