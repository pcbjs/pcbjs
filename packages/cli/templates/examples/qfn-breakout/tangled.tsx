// QFN breakout, tangled: every header turned end for end so each line crosses the other 15 of its side.
// The plain route(a, b) leaves 4 to 26 legs unrouted; each route here takes a staircase path instead.
import { breakout, env } from './breakout'

export default breakout({ name: 'QFN breakout tangled', tangle: true, ripup: env.ripup, stair: env.stair ?? [0, 1, 2, 3] })
