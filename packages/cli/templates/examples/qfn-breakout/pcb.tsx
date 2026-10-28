// QFN breakout: a QFN64 at 0.5 mm pitch broken out to four 16 pin headers in pin order, every pin a bare route(a, b).
import { breakout, env } from './breakout'

export default breakout({ name: 'QFN breakout', ripup: env.ripup, stair: env.stair })
