// M2 mounting hole: a 2.2 mm non-plated hole with a 4 mm keepout courtyard; not in the BOM or the placement file.
import type { FootprintProps } from '@pcbjs/core'
import { npth, courtyard } from '@pcbjs/lib'

export function MountingHole(props: FootprintProps) {
  const { children, ...rest } = props
  return (
    <footprint id="usbc-led:MountingHole_2.2mm_M2" value="M2" bom={false} pos={false} height={0} {...rest}>
      {npth(0, 0, 2.2)}
      {courtyard(3.6, 3.6)}
      {children}
    </footprint>
  )
}
