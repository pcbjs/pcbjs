import { bindPCB } from '../bind.js'
import { OSHPARK } from '@pcbjs/lib/rules'
import { OSHPARK_2L } from '@pcbjs/lib/stackups'
import { OSHPARK_COLORS, OSHPARK_SILK, OSHPARK_FINISHES } from '../palettes.js'

export const name = 'OSH Park 2-Layer'
export const stackup = OSHPARK_2L
export const rules = OSHPARK
export const colors = OSHPARK_COLORS
export const silkColors = OSHPARK_SILK
export const sourcing: readonly string[] = Object.freeze(['DigiKey', 'US'])
export const finishes = OSHPARK_FINISHES

const PCB = bindPCB({ name, fab: 'OSH Park', stackup, rules, colors, silkColors, finishes, sourcing })
export default PCB
