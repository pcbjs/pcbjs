import type { Board, Item, Ring } from '@pcbjs/core/model'
import { circleRing } from './path.js'
import { bbox, offset, polysToRings, strokeClosed, strokeOpen } from './geom.js'
import { isCopper } from './layers.js'
import { EdgeSet, type Box } from './spatial.js'

const cache = new WeakMap<Item, Map<string, Ring[]>>()
/** Everything derived from an item's copper rings, keyed by kind, layer and distance; an item is never written, so neither goes stale. */
const derived = new WeakMap<Item, Map<string, unknown>>()

function memo<T>(it: Item, key: string, make: () => T): T {
  let m = derived.get(it)
  if (!m) {
    m = new Map()
    derived.set(it, m)
  }
  if (m.has(key)) return m.get(key) as T
  const v = make()
  m.set(key, v)
  return v
}

export function copperLayersOf(it: Item, copper: string[]): string[] {
  switch (it.kind) {
    case 'pad':
      return it.layers.filter(isCopper)
    case 'via': {
      const a = copper.indexOf(it.layers[0]),
        b = copper.indexOf(it.layers[1])
      const [lo, hi] = a < b ? [a, b] : [b, a]
      return copper.slice(lo, hi + 1)
    }
    case 'track':
    case 'zone':
      return [it.layer]
    case 'graphic':
    case 'text':
      return isCopper(it.layer) ? [it.layer] : []
    default:
      return []
  }
}

/** Polygon rings of an item's copper on one layer (empty when it has none there). */
export function copperRings(it: Item, layer: string): Ring[] {
  let m = cache.get(it)
  if (!m) {
    m = new Map()
    cache.set(it, m)
  }
  const hit = m.get(layer)
  if (hit) return hit
  let rings: Ring[] = []
  switch (it.kind) {
    case 'pad':
      if (it.layers.includes(layer)) rings = [it.poly]
      break
    case 'via':
      rings = [circleRing(it.at[0], it.at[1], it.size / 2)]
      break
    case 'track':
      if (it.layer === layer) rings = polysToRings(strokeOpen(it.pts, it.width))
      break
    case 'zone':
      if (it.layer === layer) rings = polysToRings(it.fill)
      break
    case 'graphic':
      if (it.layer === layer)
        rings = it.fill ? it.paths.filter(r => r.length >= 3) : it.paths.flatMap((r, i) => polysToRings(it.closed[i] ? strokeClosed(r, it.width) : strokeOpen(r, it.width)))
      break
    case 'text':
      if (it.layer === layer) rings = it.polys ? polysToRings(it.polys) : it.strokes.flatMap(r => polysToRings(strokeOpen(r, it.thickness)))
      break
  }
  m.set(layer, rings)
  return rings
}

/** The bounding box of an item's copper on one layer. */
export function copperBox(it: Item, layer: string): Box {
  return memo(it, `box:${layer}`, () => bbox(copperRings(it, layer)))
}

/** An item's copper on one layer with its edges in a grid, for the predicates of spatial.ts; built once, since an item is never written. */
export function copperSet(it: Item, layer: string): EdgeSet {
  return memo(it, `edges:${layer}`, () => new EdgeSet(copperRings(it, layer)))
}

/** An item's copper on one layer offset by `delta` mm, round joins, as rings. */
export function grownRings(it: Item, layer: string, delta: number): Ring[] {
  return memo(it, `grow:${layer}:${delta}`, () => polysToRings(offset(copperRings(it, layer), delta)))
}

/** The grown copper of an item as an edge set. */
export function grownSet(it: Item, layer: string, delta: number): EdgeSet {
  return memo(it, `growedges:${layer}:${delta}`, () => new EdgeSet(grownRings(it, layer, delta)))
}

/** A round hole of radius `r` at the item's centre, offset by `delta` mm, as rings. */
export function grownHole(it: Item & { at: [number, number] }, r: number, delta: number): Ring[] {
  return memo(it, `hole:${r}:${delta}`, () => polysToRings(offset([circleRing(it.at[0], it.at[1], r)], delta)))
}

export function copperItemsOn(board: Pick<Board, 'items' | 'copper'>, layer: string, copper: string[]): Item[] {
  return board.items.filter(it => copperLayersOf(it, copper).includes(layer))
}

/** Two items are on one net only when both have one and it is the same: copper on no net is foreign to everything, itself included. */
export const sameNet = (a: string | undefined, b: string | undefined): boolean => a !== undefined && a === b
