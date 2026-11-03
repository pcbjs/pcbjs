// A one-pad test point, 2 mm round on F.Cu, left out of the BOM. TestPad('VBAT') is a part, placed as <TP1 at="…" />.
import { defineFootprint, type FootprintProps } from '@pcbjs/core'

export const TestPad = defineFootprint(
  function TestPad(props: FootprintProps) {
    const { children, ...rest } = props
    return (
      <footprint id="pcbjs:TestPad-2mm" bom={false} {...rest}>
        <pad num={1} size={2} shape="circle" />
        {children}
      </footprint>
    )
  },
  { pins: ['1'], prefix: 'TP' },
)
