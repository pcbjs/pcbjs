import { bindPCB } from '../bind.js'
import { PCBWAY } from '@pcbjs/lib/rules'
import { deepFreeze } from '@pcbjs/core/internal/rules'
import { twoLayer } from '@pcbjs/lib/stackups'
import { PCBWAY_COLORS, PCBWAY_SILK, PCBWAY_FINISHES } from '../palettes.js'

const name = 'PCBWay 2-Layer'
const stackup = deepFreeze(twoLayer({ finish: 'HASL' }))
const rules = PCBWAY
const colors = PCBWAY_COLORS
const silkColors = PCBWAY_SILK
const sourcing: readonly string[] = Object.freeze(['CN'])
const finishes = PCBWAY_FINISHES

const PCB = bindPCB({ name, fab: 'PCBWay', stackup, rules, colors, silkColors, finishes, sourcing })
export default PCB
