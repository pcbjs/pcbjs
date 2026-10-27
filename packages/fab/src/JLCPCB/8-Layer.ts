import { bindPCB } from '../bind.js'
import { JLCPCB, deepFreeze } from '@pcbjs/lib/rules'
import { eightLayer } from '@pcbjs/lib/stackups'
import { JLCPCB_COLORS, JLCPCB_SILK, JLCPCB_FINISHES } from '../palettes.js'

export const name = 'JLCPCB 8-Layer'
export const stackup = deepFreeze(eightLayer({ finish: 'ENIG' }))
export const rules = JLCPCB
export const colors = JLCPCB_COLORS
export const silkColors = JLCPCB_SILK
export const sourcing: readonly string[] = Object.freeze(['LCSC', 'CN'])
export const finishes = JLCPCB_FINISHES

const PCB = bindPCB({ name, fab: 'JLCPCB', stackup, rules, colors, silkColors, finishes, sourcing, cpl: { origin: 'center' } })
export default PCB
