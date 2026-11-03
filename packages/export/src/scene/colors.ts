// the 3D palette the viewer and the GLB share, sRGB hex
import type { Stackup } from '@pcbjs/core/internal/types'

export const COLORS = { mask: '#1b5e20', silk: '#f4f4f4', fr4: '#a8955f', edge: '#b9a978', copper: '#c87533' }
export const FINISH: Record<string, string> = {
  ENIG: '#d9b24c',
  HardGold: '#d9b24c',
  HASL: '#c9cccf',
  LeadFreeHASL: '#c9cccf',
  ImmersionSilver: '#d4d6d8',
  ImmersionTin: '#c4c6c8',
  OSP: '#c87533',
}
/** the palette colour is the mask over bare laminate in the top light, so the albedo is that colour over MASK_GAIN */
export const MASK_GAIN = 2.4
export const MASK_OPACITY = 0.94

// fab colour names, as the stackup presets and the job file spell them, mapped to a shade that reads as that board
const NAMED: Record<string, string> = {
  green: '#1b5e20',
  black: '#1a1a1a',
  blue: '#173a7a',
  red: '#8a1c1c',
  purple: '#4b1f6f',
  yellow: '#c9a400',
  white: '#ececec',
  matteblack: '#202020',
  mattegreen: '#2a5a2c',
  none: '',
}

/** A CSS colour for a stackup colour: a fab name such as "Green" or "Matte Black", or any CSS colour as given. */
export function cssColor(c: string | undefined): string | null {
  if (!c) return null
  const key = c.toLowerCase().replace(/[\s_-]+/g, '')
  if (key in NAMED) return NAMED[key] || null
  return c
}

/** The mask and silk colours of the stackup, the same on both sides. */
export function sideColors(s: Stackup | undefined): { mask: string | null; silk: string | null } {
  return { mask: cssColor(s?.maskColor), silk: cssColor(s?.silkColor) }
}

/** a chip LED's lens by its `color` option, an opaque solid in the viewer and the GLB alike */
export const LED_TINT: Record<string, string> = {
  red: '#ff2a2a',
  green: '#2fe05a',
  blue: '#2f6bff',
  yellow: '#ffd400',
  amber: '#ffae00',
  orange: '#ff8200',
}
/** the lens of a white LED or one of no known colour: grey-white with a hint of the phosphor under it */
export const LED_CLEAR = '#efebd9'
/** how far a lens glows in its own colour, a tinted one more than the clear one */
export const LED_GLOW = { tinted: 0.3, clear: 0.06 }

/** The lens colour for an LED's `color` option and whether it is the clear one. */
export function ledLens(color: string | undefined): { color: string; clear: boolean } {
  const tint = LED_TINT[(color ?? '').toLowerCase()]
  return tint ? { color: tint, clear: false } : { color: LED_CLEAR, clear: true }
}
