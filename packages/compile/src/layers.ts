export { layerTable, copperLayers, isCopper } from '@pcbjs/core/internal/layers'

/** The layer an id names, F and B swapped when the parent is on the back; ids only, as written. */
export function resolveLayer(name: string, flipped: boolean, known: Set<string>): string {
  let id = name
  if (flipped) {
    if (id.startsWith('F.')) id = 'B.' + id.slice(2)
    else if (id.startsWith('B.')) id = 'F.' + id.slice(2)
  }
  if (!known.has(id)) throw new Error(`unknown layer ${JSON.stringify(name)} (this board has: ${[...known].join(', ')})`)
  return id
}
