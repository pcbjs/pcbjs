import { bindPCB } from '../bind.js'
import { EUROCIRCUITS } from '@pcbjs/lib/rules'
import { deepFreeze } from '@pcbjs/core/internal/rules'
import { twoLayer } from '@pcbjs/lib/stackups'
import { EUROCIRCUITS_COLORS, EUROCIRCUITS_SILK, EUROCIRCUITS_FINISHES } from '../palettes.js'

const name = 'Eurocircuits 2-Layer'
const stackup = deepFreeze(twoLayer({ finish: 'LeadFreeHASL' }))
const rules = EUROCIRCUITS
const colors = EUROCIRCUITS_COLORS
const silkColors = EUROCIRCUITS_SILK
const sourcing: readonly string[] = Object.freeze(['Mouser', 'EU'])
const finishes = EUROCIRCUITS_FINISHES

const PCB = bindPCB({ name, fab: 'Eurocircuits', stackup, rules, colors, silkColors, finishes, sourcing })
export default PCB
