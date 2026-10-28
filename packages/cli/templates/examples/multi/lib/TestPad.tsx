// A one-pad test point, 2 mm round on F.Cu, left out of the BOM. TestPad('VBAT') is a part, <TestPad ref="TP1" … /> renders.
import { defineFootprint, type FootprintProps } from '@pcbjs/core'

function TestPadFootprint(props: FootprintProps) {
  const { children, ...rest } = props
  return (
    <footprint id="pcbjs:TestPad-2mm" bom={false} {...rest}>
      <pad num={1} size={2} shape="circle" />
      {children}
    </footprint>
  )
}

export const TestPad = defineFootprint(TestPadFootprint, { pins: ['1'], prefix: 'TP', id: 'pcbjs:TestPad-2mm', name: 'TestPad' })
