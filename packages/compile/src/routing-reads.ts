// Route reuse certificates describe the search input at its original solve point,
// never the previous compile's final copper or the bounds of the selected path.
import type { ObstacleWorld } from './obstacles.js'

export interface RoutingReads {
  version: 2
  /** Exact canonical values; topology is shared across searches and interned on disk. */
  globals: string
  topology: string
  requests: string
  maze: MazeReads
}

const ITEM_KINDS = new Set(['track', 'via', 'pad', 'zone', 'graphic', 'text'])
/** Strip navigation only on recognized items, never semantic fields such as terms.src. */
export function routingValue(value: unknown): string {
  return JSON.stringify(value, (_key, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const item = typeof v.id === 'number' && ITEM_KINDS.has(v.kind)
      return Object.fromEntries(
        Object.keys(v)
          .filter(k => !item || (k !== 'src' && k !== 'chain' && k !== 'uid'))
          .sort()
          .map(k => [k, v[k]]),
      )
    }
    return v
  })
}

// An ObstacleWorld version is immutable: add/remove/replace advance time. Globals
// remain uncached so rule/class changes cannot hide behind the topology token.
const TOPOLOGY = new WeakMap<ObstacleWorld, { time: number; tokens: Map<string, string> }>()

export function routingReads(world: ObstacleWorld, requests: string, net?: string, partner?: string): Omit<RoutingReads, 'maze'> {
  const b = world.board
  let snapshot = TOPOLOGY.get(world)
  if (!snapshot || snapshot.time !== world.time) TOPOLOGY.set(world, (snapshot = { time: world.time, tokens: new Map() }))
  const key = JSON.stringify([net, partner])
  let topology = snapshot.tokens.get(key)
  if (topology === undefined) {
    topology = routingValue(world.items().filter(it => it.net === net || (partner !== undefined && it.net === partner)))
    snapshot.tokens.set(key, topology)
  }
  return {
    version: 2,
    globals: routingValue({
      rules: world.rules,
      copper: b.copper,
      bbox: b.bbox,
      outline: b.outline,
      classes: b.classes,
      nets: b.schematic?.nets.filter(n => n.name === net || n.name === partner),
      keepouts: b.keepouts,
    }),
    topology,
    requests,
  }
}

export const sameRoutingReads = (a: RoutingReads | undefined, b: Omit<RoutingReads, 'maze'>): boolean =>
  a?.version === b.version && a.globals === b.globals && a.topology === b.topology && a.requests === b.requests

export interface MazeReads {
  global: string
  fields: { name: string; size: number; runs: [number, string][] }[]
  queries: { kind: 'point' | 'segment'; args: unknown[]; value: boolean }[]
}

/** Two bits per consulted cell: unread, read-free, read-blocked. No item lists per cell. */
export class MazeReader {
  private fields = new Map<Uint8Array, { name: string; bits: Uint8Array }>()
  private exact: MazeReads['queries'] = []
  private global = ''
  bind(name: string, values: Uint8Array | null | undefined): void {
    if (values) this.fields.set(values, { name, bits: new Uint8Array(Math.ceil(values.length / 4)) })
  }
  read(values: Uint8Array | null | undefined, cell: number): number {
    if (!values) return 0
    const value = values[cell]
    const field = this.fields.get(values)
    if (field) field.bits[cell >> 2] |= (value ? 2 : 1) << ((cell & 3) * 2)
    return value
  }
  query(kind: 'point' | 'segment', args: unknown[], value: boolean): boolean {
    this.exact.push({ kind, args, value })
    return value
  }
  checkpoint(global: unknown): void {
    this.global = routingValue(global)
  }
  /** Called only after a successful search, which always checkpoints before returning. */
  finish(): MazeReads {
    return {
      global: this.global,
      fields: [...this.fields].map(([values, field]) => {
        const runs: [number, string][] = []
        for (let i = 0; i < field.bits.length;) {
          if (!field.bits[i]) {
            i++
            continue
          }
          const start = i
          let text = ''
          while (i < field.bits.length && field.bits[i]) text += field.bits[i++].toString(16).padStart(2, '0')
          runs.push([start, text])
        }
        return { name: field.name, size: values.length, runs }
      }),
      queries: this.exact,
    }
  }
  validate(old: MazeReads, global: unknown, query: (kind: 'point' | 'segment', args: unknown[]) => boolean): boolean {
    if (old.global !== routingValue(global)) return false
    const arrays = new Map([...this.fields].map(([values, field]) => [field.name, values]))
    for (const field of old.fields) {
      const values = arrays.get(field.name)
      if (!values || values.length !== field.size) return false
      for (const [start, text] of field.runs) {
        if (!Number.isSafeInteger(start) || start < 0 || text.length % 2 || !/^[0-9a-f]+$/.test(text) || start * 4 >= values.length) return false
        for (let i = 0; i < text.length; i += 2) {
          const bits = parseInt(text.slice(i, i + 2), 16)
          for (let k = 0; k < 4; k++) {
            const expected = (bits >> (k * 2)) & 3
            const cell = (start + i / 2) * 4 + k
            if (expected && (expected === 3 || cell >= values.length || (values[cell] ? 2 : 1) !== expected)) return false
          }
        }
      }
    }
    return old.queries.every(q => query(q.kind, q.args) === q.value)
  }
}
