// The one layer table: code names layers by these ids; the aliases are for CLI flags and the viewer URL only.
import type { LayerDef } from './model.js'

const FIXED: Omit<LayerDef, 'order'>[] = [
  { id: 'B.CrtYd', name: 'Back courtyard', kind: 'courtyard', side: 'back', color: '#26e9ff' },
  { id: 'B.Fab', name: 'Back fabrication', kind: 'fab', side: 'back', color: '#88a0d0' },
  { id: 'B.SilkS', name: 'Back silkscreen', kind: 'silkscreen', side: 'back', color: '#e8b2a7' },
  { id: 'B.Paste', name: 'Back paste', kind: 'paste', side: 'back', color: '#00c2c2' },
  { id: 'B.Mask', name: 'Back solder mask', kind: 'mask', side: 'back', color: '#02ffee' },
  // copper goes here
  { id: 'F.Mask', name: 'Front solder mask', kind: 'mask', side: 'front', color: '#d864ff' },
  { id: 'F.Paste', name: 'Front paste', kind: 'paste', side: 'front', color: '#b4a0a0' },
  { id: 'F.SilkS', name: 'Front silkscreen', kind: 'silkscreen', side: 'front', color: '#f2eda1' },
  { id: 'F.Fab', name: 'Front fabrication', kind: 'fab', side: 'front', color: '#afafaf' },
  { id: 'F.CrtYd', name: 'Front courtyard', kind: 'courtyard', side: 'front', color: '#ff26e2' },
  { id: 'Edge.Cuts', name: 'Edge cuts', kind: 'edge', side: 'both', color: '#e6e8e3' },
  { id: 'Dwgs.User', name: 'User drawings', kind: 'user', side: 'both', color: '#c2c2c2' },
  { id: 'Cmts.User', name: 'User comments', kind: 'user', side: 'both', color: '#5994dc' },
]
// In1 to In6, KiCad's inner layer colours, distinct from F.Cu red and B.Cu blue
const INNER_COLORS = ['#7fc87f', '#ce7d2c', '#4fcbcb', '#db628b', '#a7a5c6', '#c2c200']

/** Every layer of a board with `copper` copper layers (2 to 8), back to front. */
export function layerTable(copper: number): LayerDef[] {
  checkCopper(copper)
  const cu: Omit<LayerDef, 'order'>[] = []
  cu.push({ id: 'B.Cu', name: 'Back copper', kind: 'copper', side: 'back', color: '#4d7fc4' })
  for (let i = copper - 2; i >= 1; i--) cu.push({ id: `In${i}.Cu`, name: `Inner copper ${i}`, kind: 'copper', side: 'inner', color: INNER_COLORS[(i - 1) % INNER_COLORS.length] })
  cu.push({ id: 'F.Cu', name: 'Front copper', kind: 'copper', side: 'front', color: '#c83434' })
  const all = [...FIXED.slice(0, 5), ...cu, ...FIXED.slice(5)]
  return all.map((l, i) => ({ ...l, order: i }))
}

/** Copper layer ids top to bottom: F.Cu, In1.Cu ... In(n-2).Cu, B.Cu. */
export function copperLayers(copper: number): string[] {
  checkCopper(copper)
  const out = ['F.Cu']
  for (let i = 1; i <= copper - 2; i++) out.push(`In${i}.Cu`)
  out.push('B.Cu')
  return out
}

function checkCopper(copper: number) {
  if (!Number.isInteger(copper) || copper < 2 || copper > 8) throw new Error(`copper layer count must be 2 to 8, got ${copper}`)
}

export const isCopper = (id: string) => id.endsWith('.Cu')

/** Every layer id of an 8-layer board, copper top to bottom first. */
export const LAYER_IDS: readonly string[] = [...copperLayers(8), ...FIXED.map(l => l.id)]

/** Names a CLI flag or a viewer URL takes for a layer besides its id, lower case. */
export const LAYER_ALIASES: Readonly<Record<string, string>> = {
  top: 'F.Cu',
  front: 'F.Cu',
  bottom: 'B.Cu',
  back: 'B.Cu',
  silk: 'F.SilkS',
  'f.silk': 'F.SilkS',
  'f.silkscreen': 'F.SilkS',
  'b.silk': 'B.SilkS',
  'b.silkscreen': 'B.SilkS',
  'f.courtyard': 'F.CrtYd',
  'b.courtyard': 'B.CrtYd',
  edge: 'Edge.Cuts',
  outline: 'Edge.Cuts',
  'edge.cut': 'Edge.Cuts',
}

/** The id a CLI flag or URL names: an id in any case or an alias; undefined for none. */
export function flagLayer(name: string): string | undefined {
  const k = name.trim().toLowerCase()
  return LAYER_ALIASES[k] ?? LAYER_IDS.find(id => id.toLowerCase() === k)
}
