import { defineFootprint, nets, type FootprintProps } from '@pcbjs/core'

function Mcu(props: FootprintProps) {
  return (
    <footprint id="fixture:MCU" {...props}>
      <pad num={1} name="VDD" at="-1 0" size={[0.6, 0.6]} />
      <pad num={2} name="VSSA" at="0 0" size={[0.6, 0.6]} />
      <pad num={3} name="PA0" at="1 0" size={[0.6, 0.6]} />
    </footprint>
  )
}
const MCU = defineFootprint(Mcu, { pins: ['VDD', 'VSSA', 'PA0'], prefix: 'U' })

export const { GND, VCC, SIG } = nets()
export const U1 = MCU('STM32').connect(VCC, GND, SIG)
