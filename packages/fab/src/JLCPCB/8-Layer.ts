import { bindPCB } from '../bind.js'
import { JLCPCB } from '@pcbjs/lib/rules'
import { deepFreeze } from '@pcbjs/core/internal/rules'
import { eightLayer } from '@pcbjs/lib/stackups'
import { JLCPCB_COLORS, JLCPCB_SILK, JLCPCB_FINISHES } from '../palettes.js'

const name = 'JLCPCB 8-Layer'
const stackup = deepFreeze(eightLayer({ finish: 'ENIG' }))
const rules = JLCPCB
const colors = JLCPCB_COLORS
const silkColors = JLCPCB_SILK
const sourcing: readonly string[] = Object.freeze(['LCSC', 'CN'])
const finishes = JLCPCB_FINISHES

const PCB = bindPCB({ name, fab: 'JLCPCB', stackup, rules, colors, silkColors, finishes, sourcing, cpl: { origin: 'center' } })
export default PCB
