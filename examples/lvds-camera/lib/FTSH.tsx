// Samtec FTSH-110-01-L-DV: 2 x 10 SMT header, 1.27 mm pitch. Written here because the stdlib 1.27 mm PinHeader has a
// 0.175 mm annular ring, below the JLCPCB minimum of 0.18 for plated pads.
// Frame: mm, origin at the body centre, rows along x, odd pins in the row at +y, even pins at -y, pin 1 at -x.
import { defineFootprint, type FootprintProps } from '@pcbjs/core'
import { courtyard, silkRect } from '@pcbjs/lib'

const PINS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20'] as const

function FTSHFootprint(props: FootprintProps) {
  const { children, ...rest } = props
  return (
    <footprint id="lvds:FTSH-110-01-L-DV" value="FTSH-110" height={4.3} {...rest}>
      {PINS.map((num, i) => {
        const k = Math.floor(i / 2), odd = i % 2 === 0
        return <pad num={num} at={`${(k - 4.5) * 1.27} ${odd ? 2.0 : -2.0}`} size={[0.74, 2.4]} />
      })}
      {silkRect(13.6, 1.0)}
      <circle layer="F.SilkS" cx={-6.6} cy={3.6} r={0.15} width={0.2} />
      {courtyard(14.2, 7.0)}
      {children}
    </footprint>
  )
}

export const FTSH = defineFootprint(FTSHFootprint, { pins: PINS, prefix: 'J', id: 'lvds:FTSH-110-01-L-DV', name: 'FTSH' })
