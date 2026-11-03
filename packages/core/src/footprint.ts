// defineFootprint: a footprint factory whose call makes a part.
import type { Child, Component, FootprintFactory } from './types.js'
import { type PartArgs, part, valueArgs } from './part.js'
import { SchematicError } from './nets.js'

const RENDER = Symbol.for('pcbjs.footprint.render')
/** The component that draws a part's footprint: the render of a defineFootprint factory, else the component itself. */
export const footprintRender = (f: Component): Component => (f as any)[RENDER] ?? f

/** The metadata of `defineFootprint`: `pins` inline or `as const` for typed keys, or a function of the props; `nc` pads left open. */
export interface FootprintMeta<P extends string, D extends string | number = never> {
  pins: readonly P[] | ((props: any) => readonly P[])
  /** pad ids inline or `as const`, for typed pad keys such as `J1['B6']`; types only */
  pads?: readonly D[]
  nc?: readonly (string | number)[] | ((props: any) => readonly (string | number)[])
  prefix: string
  args?: PartArgs
  /** the schematic symbol of its parts, or a function of the footprint props; default by prefix and pin names */
  symbol?: import('./sch-symbol.js').SymbolDef | ((props: any) => import('./sch-symbol.js').SymbolDef)
  /** named points in the footprint frame, mm, read on a part as `U1.points.center`, a grid origin */
  points?: Readonly<Record<string, readonly [number, number]>>
}

/** A footprint factory: its call makes a Part, `R0603('330')`, which the board places as `<R1 at="12 5" />`; the factory takes its name from `render`. */
export function defineFootprint<const P extends string, Props = any, const D extends string | number = never>(
  render: (props: Props) => Child,
  meta: FootprintMeta<P, D>,
): FootprintFactory<P, Props, `${D}`> {
  const args = meta.args ?? valueArgs
  const name = render.name || 'Footprint'
  const factory = function (this: unknown, ...a: unknown[]): any {
    const first = a[0]
    if (a.length === 1 && first && typeof first === 'object' && 'at' in first)
      throw new SchematicError(`${name} is a footprint factory, not an element: make a part, const R1 = ${name}(…), and place it, <R1 at="…" />`)
    return part(factory as any, args(...a))
  }
  Object.defineProperty(factory, 'name', { value: name })
  Object.defineProperty(factory, RENDER, { value: render })
  Object.defineProperty(factory, 'pins', { value: typeof meta.pins === 'function' ? meta.pins : Object.freeze([...meta.pins]), enumerable: true })
  if (meta.nc !== undefined) Object.defineProperty(factory, 'nc', { value: typeof meta.nc === 'function' ? meta.nc : Object.freeze([...meta.nc].map(String)), enumerable: true })
  Object.defineProperty(factory, 'prefix', { value: meta.prefix, enumerable: true })
  if (meta.symbol !== undefined) Object.defineProperty(factory, 'symbol', { value: meta.symbol, enumerable: true })
  if (meta.points !== undefined) Object.defineProperty(factory, 'points', { value: footprintPoints(name, meta.points), enumerable: true })
  return factory as any
}

/** The named points of a footprint, checked and frozen. */
function footprintPoints(name: string, pts: unknown): Readonly<Record<string, readonly [number, number]>> {
  if (!pts || typeof pts !== 'object' || Array.isArray(pts)) throw new SchematicError(`defineFootprint ${name}: points are { name: [x, y] } in mm`)
  const out: Record<string, readonly [number, number]> = {}
  for (const [k, v] of Object.entries(pts)) {
    if (!Array.isArray(v) || v.length !== 2 || !v.every(n => typeof n === 'number' && Number.isFinite(n)))
      throw new SchematicError(`defineFootprint ${name}: the point ${k} must be [x, y] in mm, got ${JSON.stringify(v)}`)
    out[k] = Object.freeze([v[0], v[1]] as const)
  }
  return Object.freeze(out)
}
