// Plane taps: a via at the point given, on the plane's net, and a short automatic route to it from the pad on the pad's own layer.
// The route stays on that layer: a router leg that ran on the plane layer itself would be invisible to later through vias.
import { route, via, type Net, type PinRef } from '@pcbjs/core'
import { GND, V3V3 } from '../stm32-dev.sch'

export function tap(net: Net, pin: PinRef, x: number, y: number, from: 'F.Cu' | 'B.Cu' = 'F.Cu') {
  return [via(net, `${x} ${y}`), route(pin, `${x} ${y} ${from}`).layers([from]).width(0.3).priority(3)]
}
/** GND, the In1.Cu plane. */
export const gnd = (pin: PinRef, x: number, y: number, from: 'F.Cu' | 'B.Cu' = 'F.Cu') => tap(GND, pin, x, y, from)
/** 3V3, the In2.Cu plane. */
export const pwr = (pin: PinRef, x: number, y: number, from: 'F.Cu' | 'B.Cu' = 'F.Cu') => tap(V3V3, pin, x, y, from)
