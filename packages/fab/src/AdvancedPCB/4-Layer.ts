import { bindPCB } from '../bind.js'
import { ADVANCEDPCB } from '@pcbjs/lib/rules'
import { deepFreeze } from '@pcbjs/core/internal/rules'
import { fourLayer } from '@pcbjs/lib/stackups'
import { ADVANCEDPCB_COLORS, ADVANCEDPCB_SILK, ADVANCEDPCB_FINISHES } from '../palettes.js'

const name = 'Advanced PCB 4-Layer'
const stackup = deepFreeze(fourLayer({ finish: 'ENIG', maskColor: 'Black' }))
const rules = ADVANCEDPCB
const colors = ADVANCEDPCB_COLORS
const silkColors = ADVANCEDPCB_SILK
const sourcing: readonly string[] = Object.freeze(['DigiKey', 'US'])
const finishes = ADVANCEDPCB_FINISHES

const PCB = bindPCB({ name, fab: 'Advanced PCB', stackup, rules, colors, silkColors, finishes, sourcing })
export default PCB
