export { bindPCB, isBoundPCB, paletteName } from './bind.js'
export type { BoundPCB, PresetInput, PresetSpec, PresetBoardProps } from './bind.js'
export { HEX } from './palettes.js'

/** Every preset module, as the path after `@pcbjs/fab/`. */
export const FABS = [
  'JLCPCB/2-Layer', 'JLCPCB/4-Layer', 'JLCPCB/4-Layer-3313', 'JLCPCB/6-Layer', 'JLCPCB/8-Layer',
  'PCBWay/2-Layer', 'PCBWay/4-Layer',
  'OSHPark/2-Layer', 'OSHPark/4-Layer',
  'Eurocircuits/2-Layer', 'Eurocircuits/4-Layer',
  'AdvancedPCB/2-Layer', 'AdvancedPCB/4-Layer',
] as const
export type FabPath = (typeof FABS)[number]
