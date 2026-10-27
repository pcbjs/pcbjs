import { bindPCB } from '../bind.js'
import { PCBWAY, deepFreeze } from '@pcbjs/lib/rules'
import { twoLayer } from '@pcbjs/lib/stackups'
import { PCBWAY_COLORS, PCBWAY_SILK, PCBWAY_FINISHES } from '../palettes.js'

export const name = 'PCBWay 2-Layer'
export const stackup = deepFreeze(twoLayer({ finish: 'HASL' }))
export const rules = PCBWAY
export const colors = PCBWAY_COLORS
export const silkColors = PCBWAY_SILK
export const sourcing: readonly string[] = Object.freeze(['CN'])
export const finishes = PCBWAY_FINISHES

const PCB = bindPCB({ name, fab: 'PCBWay', stackup, rules, colors, silkColors, finishes, sourcing })
export default PCB
