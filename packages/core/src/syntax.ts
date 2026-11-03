// The words of the copper helpers and the route chain, read by the route builder, the source-range transform, the lsp and the edit model.

/** The helpers of `@pcbjs/core` that make copper. */
export const COPPER_HELPERS = ['route', 'pour', 'via', 'keepout', 'stitch'] as const
/** The helpers whose source range the compiler records: the copper ones and the schematic's `wire`. */
export const HELPERS = [...COPPER_HELPERS, 'wire'] as const
export type Helper = (typeof HELPERS)[number]
export const isHelper = (name: string): name is Helper => (HELPERS as readonly string[]).includes(name)
export const isCopperHelper = (name: string): boolean => (COPPER_HELPERS as readonly string[]).includes(name)

/** What one argument of a chain command takes. */
export type ArgKind = 'length' | 'angle' | 'layer'

/** A chain command: the step it writes, whether it is relative, its arguments and the step fields they fill in order. */
export interface ChainSpec {
  op: 'L' | 'H' | 'V' | 'A' | 'U' | 'Z' | 'X'
  rel: boolean
  args: readonly ArgKind[]
  fields: readonly string[]
  /** one argument alone is a waypoint, `.L('5 16')`, `.X(via)` */
  waypoint?: true
  /** a differential pair's only */
  pair?: true
}

const len2 = ['length', 'length'] as const
const xy = ['x', 'y'] as const
const arc = ['length', 'length', 'angle'] as const

/** The commands of a route chain that write a step, `route(a, b).V(14).via('B.Cu').X()`, each with a source range of its own. */
export const CHAIN = {
  L: { op: 'L', rel: false, args: len2, fields: xy, waypoint: true },
  l: { op: 'L', rel: true, args: len2, fields: xy },
  H: { op: 'H', rel: false, args: ['length'], fields: ['x'] },
  h: { op: 'H', rel: true, args: ['length'], fields: ['x'] },
  V: { op: 'V', rel: false, args: ['length'], fields: ['y'] },
  v: { op: 'V', rel: true, args: ['length'], fields: ['y'] },
  A: { op: 'A', rel: false, args: arc, fields: [...xy, 'angle'] },
  a: { op: 'A', rel: true, args: arc, fields: [...xy, 'angle'] },
  via: { op: 'U', rel: false, args: ['layer'], fields: ['layer'] },
  cross: { op: 'U', rel: false, args: ['layer'], fields: ['layer'], pair: true },
  Z: { op: 'Z', rel: false, args: [], fields: [] },
  X: { op: 'X', rel: false, args: [], fields: [], waypoint: true },
} as const satisfies Record<string, ChainSpec>
export type ChainName = keyof typeof CHAIN

export const CHAIN_NAMES = Object.keys(CHAIN) as ChainName[]
export const isChain = (name: string): name is ChainName => Object.hasOwn(CHAIN, name)

/** The commands whose arguments are all lengths and angles. */
export const isGeometric = (name: string): boolean => isChain(name) && CHAIN[name].args.length > 0 && CHAIN[name].args.every(a => a !== 'layer')

const OTHER: Record<string, string> = { W: 'width', B: 'branch', XZ: 'X' }

/** The chain method a step was written as: `L`, `l`, `H`, `via`, `cross`, `X` and so on. */
export function methodOf(st: { op: string; rel?: boolean; cross?: boolean }): string {
  if (st.op === 'U') return st.cross ? 'cross' : 'via'
  return CHAIN_NAMES.find(k => CHAIN[k].op === st.op && CHAIN[k].rel === !!st.rel) ?? OTHER[st.op] ?? st.op
}
