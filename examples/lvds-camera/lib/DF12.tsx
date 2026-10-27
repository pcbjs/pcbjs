// Hirose DF12(3.0)-30DS-0.5V(86): 30 pin board to board receptacle, 0.5 mm pitch, two rows of 15.
// Frame: mm, origin at the body centre, rows along x, odd pins in the row at -y, even pins at +y, pin 1 at -x.
// Land pattern approximated from the Hirose drawing: 0.3 x 1.3 mm pads at y = +-1.9, two 0.7 mm locating holes.
import { defineFootprint, type FootprintProps } from '@pcbjs/core'
import { npth, courtyard, silkRect } from '@pcbjs/lib'

const PINS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '24', '25', '26', '27', '28', '29', '30'] as const

function DF12Footprint(props: FootprintProps) {
  const { children, ...rest } = props
  return (
    <footprint id="lvds:DF12-30DS-0.5V" value="DF12-30DS" height={3} {...rest}>
      {PINS.map((num, i) => {
        const k = Math.floor(i / 2), odd = i % 2 === 0
        return <pad num={num} at={`${(k - 7) * 0.5} ${odd ? -1.9 : 1.9}`} size={[0.3, 1.3]} />
      })}
      {npth(-4.6, 0, 0.7)}
      {npth(4.6, 0, 0.7)}
      {silkRect(8.6, 2.2)}
      <circle layer="F.SilkS" cx={-4.2} cy={-2.3} r={0.15} width={0.2} />
      {courtyard(10.4, 5.4)}
      {children}
    </footprint>
  )
}

export const DF12 = defineFootprint(DF12Footprint, { pins: PINS, prefix: 'J', id: 'lvds:DF12-30DS-0.5V', name: 'DF12' })
