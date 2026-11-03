import { bindPCB } from '../bind.js'
import { OSHPARK } from '@pcbjs/lib/rules'
import { OSHPARK_4L } from '@pcbjs/lib/stackups'
import { OSHPARK_COLORS, OSHPARK_SILK, OSHPARK_FINISHES } from '../palettes.js'

const name = 'OSH Park 4-Layer'
const stackup = OSHPARK_4L
const rules = OSHPARK
const colors = OSHPARK_COLORS
const silkColors = OSHPARK_SILK
const sourcing: readonly string[] = Object.freeze(['DigiKey', 'US'])
const finishes = OSHPARK_FINISHES

const PCB = bindPCB({ name, fab: 'OSH Park', stackup, rules, colors, silkColors, finishes, sourcing })
export default PCB
