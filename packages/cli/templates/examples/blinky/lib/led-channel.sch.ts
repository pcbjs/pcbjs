// One LED channel as a circuit: a resistor and an LED from the supply to the switch, joined by the private net `led`.
// Every instance gets its own `led`, named after the instance, such as CH1/led. Layouts for it are in led-channel*.layout.tsx.
import { circuit, type Ports } from '@pcbjs/core'
import { R0603, LED0603 } from '@pcbjs/lib'

export const ledChannel = circuit('ledChannel', ({ VCC, SW }: Ports<'VCC' | 'SW'>, { nets: { led } }) => ({
  R: R0603('330').connect(VCC, led),
  D: LED0603('green', { MPN: 'LTST-C190GKT', Manufacturer: 'Lite-On' }).connect({ A: led, K: SW }),
}))
