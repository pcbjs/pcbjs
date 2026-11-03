// A user footprint written from scratch: SOT-23, pins 1 and 2 on the left, 3 on the right.
// defineFootprint makes a factory of it: SOT23('MMBT3904') is a part, named by the constant it is bound to, and placed as <Q1 at="…" />.
import { defineFootprint, type FootprintProps } from '@pcbjs/core'

export const SOT23 = defineFootprint(
  function SOT23(props: FootprintProps) {
    const { children, ...rest } = props
    return (
      <footprint id="pcbjs:SOT-23" value="SOT-23" height={1.1} model={{ kind: 'sot23', pins: 3 }} {...rest}>
        <pad num={1} at="-1.0mm -0.95mm" size={[0.9, 0.8]} />
        <pad num={2} at="-1.0mm 0.95mm" size={[0.9, 0.8]} />
        <pad num={3} at="1.0mm 0" size={[0.9, 0.8]} />
        <rect layer="F.CrtYd" x={-1.7} y={-1.7} w={3.4} h={3.4} width={0.05} />
        <rect layer="F.Fab" x={-0.7} y={-1.5} w={1.4} h={3} />
        <path layer="F.SilkS" d="M -0.9 -1.6 H 0.9 M -0.9 1.6 H 0.9" />
        <line layer="F.SilkS" x1={-0.9} y1={-1.6} x2={-0.9} y2={-1.5} width={0.2} />
        {children}
      </footprint>
    )
  },
  { pins: ['1', '2', '3'], prefix: 'Q' },
)
