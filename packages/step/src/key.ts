import { createHash } from 'node:crypto'
import { DEFAULT_OPTIONS, type StepOptions } from './mesh.js'

// bump when the conversion or the binary changes, so older caches convert again
export const CONVERTER_VERSION = 1

/** The options with their defaults, in a fixed key order. */
export function fullOptions(opts: StepOptions = {}): Required<StepOptions> {
  return { linearDeflection: opts.linearDeflection ?? DEFAULT_OPTIONS.linearDeflection, angularDeflection: opts.angularDeflection ?? DEFAULT_OPTIONS.angularDeflection }
}

export function meshKey(content: Uint8Array, opts: StepOptions = {}): string {
  const o = fullOptions(opts)
  return createHash('sha256').update(content).update(`\0pcbjs-step v${CONVERTER_VERSION} ${o.linearDeflection} ${o.angularDeflection}`).digest('hex')
}
