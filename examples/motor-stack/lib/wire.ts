// Route helpers: pcbjs has no route for a whole net, so a net with several pads becomes a chain of automatic legs, one per neighbour pair.
import { route, type RouteEnd } from '@pcbjs/core'

export function chain(width: number, ...ends: RouteEnd[]) {
  return ends.slice(1).map((b, i) => route(ends[i]).X(b).width(width))
}
