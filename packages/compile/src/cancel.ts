// The cancel of a compile: `pulse()` reads the signal of the compile running at its cancel points, see docs/design.md, Cancel points.

/** Thrown when the compile's signal is aborted; a cancelled compile returns nothing, and the stages it finished stay in the cache. */
export class CancelledError extends Error {
  constructor() {
    super('compile cancelled')
    this.name = 'CancelledError'
  }
}

/** A cancel point of `signal`: throws CancelledError once it is aborted. */
export const cancelPoint =
  (signal?: { readonly aborted: boolean }): (() => void) =>
  () => {
    if (signal?.aborted) throw new CancelledError()
  }

type Gap = (ms: number) => void
interface Pulse {
  tick: () => void
  onGap?: Gap
  /** performance.now() of the last pulse */
  last: number
}
let current: Pulse | null = null

/** Run `fn` with `tick` as the cancel point `pulse` reads; `onGap`, for tests, hears the ms between pulses, and a nested call keeps the outer one's. */
export function pulsed<T>(tick: () => void, fn: () => T, onGap: Gap | undefined = current?.onGap): T {
  const was = current
  const now: Pulse = { tick, onGap, last: performance.now() }
  current = now
  try {
    return fn()
  } finally {
    onGap?.(performance.now() - now.last)
    current = was
    if (was) was.last = performance.now()
  }
}

/** The cancel point of the compile running: every stage loop calls it, a search every few hundred steps, so a cancel lands within a few ms. */
export function pulse(): void {
  const c = current
  if (!c) return
  if (c.onGap) {
    c.onGap(performance.now() - c.last)
    c.last = performance.now()
  }
  c.tick()
}
