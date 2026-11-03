import type { Stackup } from '@pcbjs/core/internal/types'
import { cssColor } from '@pcbjs/export/internal/scene/colors'

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

const colorOf = (s: Stackup, type: string) => (type === 'mask' ? s.maskColor : type === 'silk' ? s.silkColor : undefined)

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
        return row(l.type, `${l.side}.${l.type === 'mask' ? 'Mask' : l.type === 'silk' ? 'SilkS' : 'Paste'}`, l.thickness, colorOf(s, l.type) ?? '', cssColor(colorOf(s, l.type)))
    }
  })
}
