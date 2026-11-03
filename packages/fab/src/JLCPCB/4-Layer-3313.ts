// JLC04161H-3313 stackup: 50 ohm on F.Cu is about 0.17 mm, against 0.37 mm on the 7628 stackup.
import { bindPCB } from '../bind.js'
import { JLCPCB } from '@pcbjs/lib/rules'
import { JLCPCB_4L_3313 } from '@pcbjs/lib/stackups'
import { JLCPCB_COLORS, JLCPCB_SILK, JLCPCB_FINISHES } from '../palettes.js'

const name = 'JLCPCB 4-Layer 3313'
const stackup = JLCPCB_4L_3313
const rules = JLCPCB
const colors = JLCPCB_COLORS
const silkColors = JLCPCB_SILK
const sourcing: readonly string[] = Object.freeze(['LCSC', 'CN'])
const finishes = JLCPCB_FINISHES

const PCB = bindPCB({ name, fab: 'JLCPCB', stackup, rules, colors, silkColors, finishes, sourcing, cpl: { origin: 'center' } })
export default PCB
