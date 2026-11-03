// JLC04161H-7628 stackup; controlled impedance at fine pitch on the outer layers wants 4-Layer-3313.
import { bindPCB } from '../bind.js'
import { JLCPCB } from '@pcbjs/lib/rules'
import { JLCPCB_4L_7628 } from '@pcbjs/lib/stackups'
import { JLCPCB_COLORS, JLCPCB_SILK, JLCPCB_FINISHES } from '../palettes.js'

const name = 'JLCPCB 4-Layer'
const stackup = JLCPCB_4L_7628
const rules = JLCPCB
const colors = JLCPCB_COLORS
const silkColors = JLCPCB_SILK
const sourcing: readonly string[] = Object.freeze(['LCSC', 'CN'])
const finishes = JLCPCB_FINISHES

const PCB = bindPCB({ name, fab: 'JLCPCB', stackup, rules, colors, silkColors, finishes, sourcing, cpl: { origin: 'center' } })
export default PCB
