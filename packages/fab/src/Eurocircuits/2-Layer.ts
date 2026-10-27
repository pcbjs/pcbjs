import { bindPCB } from '../bind.js'
import { EUROCIRCUITS, deepFreeze } from '@pcbjs/lib/rules'
import { twoLayer } from '@pcbjs/lib/stackups'
import { EUROCIRCUITS_COLORS, EUROCIRCUITS_SILK, EUROCIRCUITS_FINISHES } from '../palettes.js'

export const name = 'Eurocircuits 2-Layer'
export const stackup = deepFreeze(twoLayer({ finish: 'LeadFreeHASL' }))
export const rules = EUROCIRCUITS
export const colors = EUROCIRCUITS_COLORS
export const silkColors = EUROCIRCUITS_SILK
export const sourcing: readonly string[] = Object.freeze(['Mouser', 'EU'])
export const finishes = EUROCIRCUITS_FINISHES

const PCB = bindPCB({ name, fab: 'Eurocircuits', stackup, rules, colors, silkColors, finishes, sourcing })
export default PCB
