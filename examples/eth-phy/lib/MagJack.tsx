// A gigabit RJ45 magjack with two LEDs, in the shape of the Pulse JK0654219NL: integrated magnetics, ten signal pins in two
// staggered rows, two LED pairs, two shield tabs and two plastic pegs. The dimensions are approximate; check the datasheet
// before ordering. Frame: mm, origin at the body centre, the mouth at -x, the pins at +x.
import { defineFootprint, type FootprintProps } from '@pcbjs/core'
import { tht, npth, courtyard, silkOutline } from '@pcbjs/lib'

const SIGNALS = ['CT', 'D1P', 'D1N', 'D2P', 'D2N', 'D3P', 'D3N', 'D4P', 'D4N', 'CT'] as const

function MagJackFootprint(props: FootprintProps) {
  const { children, ...rest } = props
  return (
    <footprint id="eth:RJ45_JK0654219NL" value="JK0654219NL" {...rest}>
      {/* signal pins: 1.02 mm apart in y, odd pins in the row at x 6.0, even pins at x 7.78 */}
      {SIGNALS.map((name, i) => tht(i + 1, i % 2 ? 7.78 : 6.0, Math.round((i - 4.5) * 102) / 100, 1.3, 0.9, { name }))}
      {/* LEDs: anode and cathode of the left LED at -y, of the right LED at +y */}
      {tht(11, 2.0, -6.35, 1.5, 1.0, { name: 'L1A' })}
      {tht(12, 2.0, -3.81, 1.5, 1.0, { name: 'L1K' })}
      {tht(13, 2.0, 3.81, 1.5, 1.0, { name: 'L2K' })}
      {tht(14, 2.0, 6.35, 1.5, 1.0, { name: 'L2A' })}
      {/* shield tabs and plastic pegs */}
      {tht(15, -4.0, -7.75, 2.6, 1.6, { name: 'SH' })}
      {tht(16, -4.0, 7.75, 2.6, 1.6, { name: 'SH' })}
      {npth(-6.5, -5.2, 3.25)}
      {npth(-6.5, 5.2, 3.25)}
      {silkOutline(21.3, 16, { pads: [-7.75, 7.75].map(y => ({ num: '15', name: 'SH', x: -4, y, w: 2.6, h: 2.6 })) })}
      {courtyard(21.8, 16.5)}
      {children}
    </footprint>
  )
}

export const MagJack = defineFootprint(MagJackFootprint, {
  pins: ['CT', 'D1P', 'D1N', 'D2P', 'D2N', 'D3P', 'D3N', 'D4P', 'D4N', 'L1A', 'L1K', 'L2A', 'L2K', 'SH'],
  prefix: 'J',
  id: 'eth:RJ45_JK0654219NL',
})
