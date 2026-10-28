// Colours by the fab order form name; the hex values match the viewer table in packages/viewer/src/stackup.ts.
import type { Finish } from '@pcbjs/core/types'

export const HEX = {
  Green: '#1b5e20',
  Red: '#8a1c1c',
  Yellow: '#c9a400',
  Blue: '#173a7a',
  White: '#ececec',
  Black: '#1a1a1a',
  Purple: '#4b1f6f',
  'Matte Black': '#202020',
  'Matte Green': '#2a5a2c',
} as const

type Name = keyof typeof HEX
export const palette = (...names: Name[]): Record<string, string> => Object.fromEntries(names.map(n => [n, HEX[n]]))

export const JLCPCB_COLORS = palette('Green', 'Red', 'Yellow', 'Blue', 'White', 'Black', 'Purple')
export const JLCPCB_SILK = palette('White', 'Black')
export const JLCPCB_FINISHES: Finish[] = ['HASL', 'LeadFreeHASL', 'ENIG']

export const PCBWAY_COLORS = palette('Green', 'Red', 'Yellow', 'Blue', 'White', 'Black', 'Purple', 'Matte Black', 'Matte Green')
export const PCBWAY_SILK = palette('White', 'Black')
export const PCBWAY_FINISHES: Finish[] = ['HASL', 'LeadFreeHASL', 'ENIG', 'OSP', 'ImmersionSilver', 'ImmersionTin', 'HardGold']

export const OSHPARK_COLORS = palette('Purple')
export const OSHPARK_SILK = palette('White')
export const OSHPARK_FINISHES: Finish[] = ['ENIG']

export const EUROCIRCUITS_COLORS = palette('Green', 'Red', 'Blue', 'White', 'Black')
export const EUROCIRCUITS_SILK = palette('White', 'Black')
export const EUROCIRCUITS_FINISHES: Finish[] = ['LeadFreeHASL', 'ENIG', 'ImmersionSilver', 'OSP']

export const ADVANCEDPCB_COLORS = palette('Green', 'Red', 'Blue', 'White', 'Black')
export const ADVANCEDPCB_SILK = palette('White', 'Black')
export const ADVANCEDPCB_FINISHES: Finish[] = ['HASL', 'LeadFreeHASL', 'ENIG', 'ImmersionSilver', 'OSP']
