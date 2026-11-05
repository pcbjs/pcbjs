import { DEFAULT_OPTIONS, type StepOptions } from './mesh.js'
import { sha256 } from './sha256.js'

// bump when the conversion or the binary changes, so older caches convert again
export const CONVERTER_VERSION = 2

/** The options with their defaults, in a fixed key order. */
export function fullOptions(opts: StepOptions = {}): Required<StepOptions> {
  return { linearDeflection: opts.linearDeflection ?? DEFAULT_OPTIONS.linearDeflection, angularDeflection: opts.angularDeflection ?? DEFAULT_OPTIONS.angularDeflection }
}

/** node:crypto in Node, loaded lazily so the key is computed alike in a browser. */
function nodeCrypto(): typeof import('node:crypto') | null {
  try {
    return (globalThis as any).process?.getBuiltinModule?.('node:crypto') ?? null
  } catch {
    return null
  }
}

export function meshKey(content: Uint8Array, opts: StepOptions = {}): string {
  const o = fullOptions(opts)
  const tail = `\0pcbjs-step v${CONVERTER_VERSION} ${o.linearDeflection} ${o.angularDeflection}`
  const c = nodeCrypto()
  if (c) return c.createHash('sha256').update(content).update(tail).digest('hex')
  const t = new TextEncoder().encode(tail)
  const all = new Uint8Array(content.length + t.length)
  all.set(content)
  all.set(t, content.length)
  return sha256(all)
}
