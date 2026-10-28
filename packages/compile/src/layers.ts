import type { LayerDef } from '@pcbjs/core/model'

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

const ALIAS: Record<string, string> = {
  top: 'F.Cu',
  'f.cu': 'F.Cu',
  front: 'F.Cu',
  bottom: 'B.Cu',
  'b.cu': 'B.Cu',
  back: 'B.Cu',
  edge: 'Edge.Cuts',
  'edge.cut': 'Edge.Cuts',
  'edge.cuts': 'Edge.Cuts',
  outline: 'Edge.Cuts',
  'f.silk': 'F.SilkS',
  'f.silks': 'F.SilkS',
  'f.silkscreen': 'F.SilkS',
  silk: 'F.SilkS',
  'b.silk': 'B.SilkS',
  'b.silks': 'B.SilkS',
  'b.silkscreen': 'B.SilkS',
  'f.mask': 'F.Mask',
  'b.mask': 'B.Mask',
  'f.paste': 'F.Paste',
  'b.paste': 'B.Paste',
  'f.fab': 'F.Fab',
  'b.fab': 'B.Fab',
  'f.crtyd': 'F.CrtYd',
  'f.courtyard': 'F.CrtYd',
  'b.crtyd': 'B.CrtYd',
  'b.courtyard': 'B.CrtYd',
  'dwgs.user': 'Dwgs.User',
  'user.drawings': 'Dwgs.User',
  'cmts.user': 'Cmts.User',
  'user.comments': 'Cmts.User',
}

/** Canonical layer id; side-relative names swap F/B when the parent is on the back. */
export function resolveLayer(name: string, flipped: boolean, known: Set<string>): string {
  const low = name.toLowerCase()
  let id = ALIAS[low]
  if (!id) {
    const m = /^in(\d+)\.cu$/.exec(low)
    id = m ? `In${m[1]}.Cu` : name
  }
  if (flipped) {
    if (id.startsWith('F.')) id = 'B.' + id.slice(2)
    else if (id.startsWith('B.')) id = 'F.' + id.slice(2)
  }
  if (!known.has(id)) throw new Error(`unknown layer ${JSON.stringify(name)} (this board has: ${[...known].join(', ')})`)
  return id
}

export const isCopper = (id: string) => id.endsWith('.Cu')
