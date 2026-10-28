import type { Stackup, StackupLayer } from '@pcbjs/core/types'

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

/** The mask and silk colours of one side: the side's own mask or silk layer first, then the stackup's colour. */
export function sideColors(s: Stackup | undefined, side: 'F' | 'B'): { mask: string | null; silk: string | null } {
  const layer = (type: 'mask' | 'silk') => s?.layers.find(l => l.type === type && l.side === side) as Extract<StackupLayer, { type: 'mask' }> | undefined
  return {
    mask: cssColor(layer('mask')?.color) ?? cssColor(s?.maskColor),
    silk: cssColor(layer('silk')?.color) ?? cssColor(s?.silkColor),
  }
}

/** `title` is the full description for a tooltip: the dielectric constant and loss tangent that the row leaves out. */
export interface StackupRow {
  type: string
  name: string
  thickness: string
  detail: string
  color: string | null
  title: string
}

const mm = (v: number | undefined) => (v === undefined ? '' : String(+v.toFixed(4)))
function row(type: string, name: string, thickness: number | undefined, detail: string, color: string | null, extra: string[] = []): StackupRow {
  const t = mm(thickness)
  return { type, name, thickness: t, detail, color, title: [type, name, t && `${t} mm`, detail, ...extra].filter(Boolean).join(', ') }
}

/** One row per stackup layer, top to bottom. */
export function stackupRows(s: Stackup): StackupRow[] {
  return s.layers.map(l => {
    switch (l.type) {
      case 'copper':
        return row('copper', l.name, l.thickness, l.weight !== undefined ? `${l.weight} oz` : '', null)
      case 'core':
      case 'prepreg':
        return row(l.type, '', l.thickness, l.material ?? '', null, [l.er !== undefined ? `er ${l.er}` : '', l.lossTangent !== undefined ? `loss tangent ${l.lossTangent}` : ''])
      default:
        return row(l.type, `${l.side}.${l.type === 'mask' ? 'Mask' : l.type === 'silk' ? 'SilkS' : 'Paste'}`, l.thickness, l.color ?? '', cssColor(l.color))
    }
  })
}
