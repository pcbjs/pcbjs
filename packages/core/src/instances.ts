// Which instances a write to a definition reaches, and where an instance draws, read from the circuit records and the edit nodes; see docs/editing.md.
import type { BoardSchematicCircuit, EditNode } from './model.js'

type Mat = EditNode['m']
type Record_ = Pick<BoardSchematicCircuit, 'path' | 'def' | 'layout'>

/** Every instance a write to the source of `def` reaches: the instances of that circuit or group, or those its layout placed; document order. */
export const reachOf = <C extends Record_>(circuits: readonly C[], def: string): C[] => circuits.filter(c => c.def === def || c.layout === def)

/** The definition isolating an instance enters: the layout that placed it, else its own. */
export const shownDef = (c: Record_): string => c.layout ?? c.def

/** The name a definition key ends in, `LedChannelRow` of `lib/led-channel.layout.tsx#LedChannelRow`. */
export const defName = (key: string): string => key.slice(key.lastIndexOf('#') + 1)

export const mulMat = (a: Mat, b: Mat): Mat => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
]

/** The innermost circuit instance among a node's frames, by the circuit records, a named group passed over: whose layout element placed it. */
export function instanceIn(frames: EditNode['frames'], circuits: readonly Pick<BoardSchematicCircuit, 'path' | 'kind'>[]): string | null {
  const insts = new Set(circuits.filter(c => c.kind === 'circuit').map(c => c.path.join('/')))
  return [...(frames ?? [])].reverse().find(f => insts.has(f.inst))?.inst ?? null
}

/** The board frame of the instance `inst` from a node's frames, walking them outermost first; null when the node is not inside it. */
export function frameOf(frames: EditNode['frames'], inst: string): Mat | null {
  let m: Mat = [1, 0, 0, 1, 0, 0]
  for (const f of frames ?? []) {
    m = mulMat(m, f.m)
    if (f.inst === inst) return m
  }
  return null
}
