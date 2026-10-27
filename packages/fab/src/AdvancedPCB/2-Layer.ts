import { bindPCB } from '../bind.js'
import { ADVANCEDPCB, deepFreeze } from '@pcbjs/lib/rules'
import { twoLayer } from '@pcbjs/lib/stackups'
import { ADVANCEDPCB_COLORS, ADVANCEDPCB_SILK, ADVANCEDPCB_FINISHES } from '../palettes.js'

export const name = 'Advanced PCB 2-Layer'
export const stackup = deepFreeze(twoLayer({ finish: 'ENIG', maskColor: 'Black' }))
export const rules = ADVANCEDPCB
export const colors = ADVANCEDPCB_COLORS
export const silkColors = ADVANCEDPCB_SILK
export const sourcing: readonly string[] = Object.freeze(['DigiKey', 'US'])
export const finishes = ADVANCEDPCB_FINISHES

const PCB = bindPCB({ name, fab: 'Advanced PCB', stackup, rules, colors, silkColors, finishes, sourcing })
export default PCB
