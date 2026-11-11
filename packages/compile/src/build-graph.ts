// Synchronous demand queries. Fingerprints describe semantics; keys and definitions must not depend on transient item ids.
export interface BuildContext {
  read<T>(key: string): T
}

type Compute = { definition: string; run: (ctx: BuildContext) => unknown; fingerprint: (value: any) => string }
interface Node {
  compute?: Compute
  value?: unknown
  fingerprint?: string
  version: number
  has: boolean
  ready: boolean
  force: boolean
  reads: Map<string, number>
}
interface Frame {
  key: string
  reads: Map<string, number> | null
  failure?: { error: unknown }
}

export class BuildCycleError extends Error {
  readonly path: readonly string[]
  constructor(path: string[]) {
    super(`Build dependency cycle: ${path.join(' -> ')}`)
    this.name = 'BuildCycleError'
    this.path = Object.freeze(path)
  }
}

export class BuildRevisionError extends Error {
  constructor(key: string) {
    super(`Build inputs changed while computing ${key}`)
    this.name = 'BuildRevisionError'
  }
}

/** Results transfer ownership to the graph: only plain data, recursively frozen, never a mutable Board or external handle. */
function own<T>(value: T, seen = new Set<object>()): T {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value
  if (typeof value === 'function') throw new Error('Build results must be plain data')
  if (seen.has(value)) return value
  const proto = Object.getPrototypeOf(value)
  if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) throw new Error('Build results must be plain data')
  seen.add(value)
  for (const key of Reflect.ownKeys(value)) {
    const prop = Object.getOwnPropertyDescriptor(value, key)!
    if (!('value' in prop)) throw new Error('Build results must not have accessors')
    own(prop.value, seen)
  }
  return Object.freeze(value)
}

/** Demand-driven queries with transactional read sets and semantic early cutoff. Definitions may refresh closures without changing their identity. */
export class BuildGraph implements BuildContext {
  private nodes = new Map<string, Node>()
  private users = new Map<string, Set<string>>()
  private stack: Frame[] = []
  private epoch = 0
  private serial = 0

  constructor(private check: () => void = () => {}) {}

  get revision(): number {
    return this.epoch
  }

  /** A new synchronous build may reuse validated products, with the current cancellation guard. */
  begin(check: () => void = () => {}): void {
    this.epoch++
    this.check = check
  }

  input<T>(key: string, value: T, fingerprint: string): void {
    const old = this.nodes.get(key)
    if (old && !old.compute && old.fingerprint === fingerprint) return
    const owned = own(value)
    this.epoch++
    if (old) this.detach(key, old.reads)
    this.nodes.set(key, { value: owned, fingerprint, version: ++this.serial, has: true, ready: true, force: false, reads: new Map() })
    this.suspect(key)
  }

  define<T>(key: string, definition: string, run: (ctx: BuildContext) => T, fingerprint: (value: T) => string): void {
    const old = this.nodes.get(key)
    const same = old?.compute?.definition === definition
    if (old) old.compute = { definition, run, fingerprint }
    else this.nodes.set(key, { compute: { definition, run, fingerprint }, version: 0, has: false, ready: false, force: true, reads: new Map() })
    if (same) return
    this.epoch++
    const node = this.nodes.get(key)!
    node.ready = false
    node.force = true
    this.suspect(key)
  }

  remove(key: string): void {
    const node = this.nodes.get(key)
    if (!node) return
    this.epoch++
    this.detach(key, node.reads)
    this.nodes.delete(key)
    this.suspect(key)
  }

  /** Force this query to rerun; its consumers still stop at an unchanged semantic result. */
  invalidate(key: string): void {
    const node = this.nodes.get(key)
    if (!node?.compute) return
    this.epoch++
    node.ready = false
    node.force = true
    this.suspect(key)
  }

  read<T>(key: string): T {
    const parent = this.stack.at(-1)
    try {
      const node = this.ensure(key)
      parent?.reads?.set(key, node.version)
      return node.value as T
    } catch (error) {
      if (parent?.reads) parent.failure = { error }
      throw error
    }
  }

  private ensure(key: string): Node {
    this.check()
    const cycle = this.stack.findIndex(f => f.key === key)
    if (cycle >= 0) throw new BuildCycleError([...this.stack.slice(cycle).map(f => f.key), key])
    const node = this.nodes.get(key)
    if (!node) throw new Error(`Unknown build input or query: ${key}`)
    if (node.ready) return node
    const compute = node.compute!
    const revision = this.epoch
    const frame: Frame = { key, reads: null }
    this.stack.push(frame)
    try {
      let changed = node.force || !node.has
      if (!changed)
        for (const [dep, version] of node.reads) {
          if (!this.nodes.has(dep) || this.ensure(dep).version !== version) {
            changed = true
            break
          }
        }
      if (!changed) {
        this.validate(frame, revision)
        node.ready = true
        return node
      }
      frame.reads = new Map()
      const result = compute.run(this)
      this.validate(frame, revision)
      const value = own(result)
      const fingerprint = compute.fingerprint(value)
      this.validate(frame, revision)
      this.detach(key, node.reads)
      for (const dep of frame.reads.keys()) {
        let users = this.users.get(dep)
        if (!users) this.users.set(dep, (users = new Set()))
        users.add(key)
      }
      node.reads = frame.reads
      if (!node.has || node.fingerprint !== fingerprint) {
        node.value = value
        node.fingerprint = fingerprint
        node.version = ++this.serial
      }
      node.has = true
      node.ready = true
      node.force = false
      return node
    } finally {
      this.stack.pop()
    }
  }

  private validate(frame: Frame, revision: number): void {
    this.check()
    if (frame.failure) throw frame.failure.error
    if (revision !== this.epoch) throw new BuildRevisionError(frame.key)
  }

  private detach(key: string, reads: Map<string, number>): void {
    for (const dep of reads.keys()) {
      const users = this.users.get(dep)
      users?.delete(key)
      if (!users?.size) this.users.delete(dep)
    }
  }

  private suspect(key: string, seen = new Set<string>()): void {
    if (seen.has(key)) return
    seen.add(key)
    for (const user of this.users.get(key) ?? []) {
      const node = this.nodes.get(user)
      if (node) node.ready = false
      this.suspect(user, seen)
    }
  }
}
