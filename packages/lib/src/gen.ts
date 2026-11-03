// Generators are memoised so `source(SOT23(5), …)` finds the parts that `SOT23(5)` made elsewhere.

const memo = new Map<string, unknown>()

export function memoised<T>(family: string, args: unknown[], build: () => T): T {
  const key = `${family}:${JSON.stringify(args)}`
  let f = memo.get(key) as T | undefined
  if (f === undefined) {
    f = build()
    memo.set(key, f)
  }
  return f
}

export function oneOf<T>(gen: string, what: string, v: T, allowed: readonly T[]): void {
  if (!allowed.includes(v)) throw new TypeError(`${gen}: ${what} must be ${allowed.map(a => JSON.stringify(a)).join(', ')}, got ${JSON.stringify(v)}`)
}

export function mmArg(gen: string, what: string, v: unknown, form = 'a positive number of mm'): asserts v is number {
  if (!(typeof v === 'number' && Number.isFinite(v) && v > 0)) throw new TypeError(`${gen}: ${what} must be ${form}, got ${show(v)}`)
}

export function sizeArg(gen: string, what: string, v: unknown, hint = ''): asserts v is number | [number, number] {
  const ok = (x: unknown) => typeof x === 'number' && Number.isFinite(x) && x > 0
  if (ok(v) || (Array.isArray(v) && v.length === 2 && v.every(ok))) return
  throw new TypeError(`${gen}: ${what} must be a size in mm, one number or [w, h], got ${show(v)}${hint}`)
}

export function intArg(gen: string, what: string, v: unknown, min: number, max = Infinity): asserts v is number {
  if (!(typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max))
    throw new TypeError(`${gen}: ${what} must be a whole number ${max === Infinity ? `of at least ${min}` : `from ${min} to ${max}`}, got ${show(v)}`)
}

export function optsArg(gen: string, v: unknown, known: readonly string[], position = 'the options'): void {
  if (v === undefined) return
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new TypeError(`${gen}: ${position} must be an object such as { prefix: 'J' }, got ${show(v)}`)
  if ('pinNames' in v) throw new TypeError(`${gen}: rename pins with withPins(footprint, names), not a pinNames option`)
  const all = [...known, 'prefix', 'value', 'silk']
  for (const k of Object.keys(v)) if (!all.includes(k)) throw new TypeError(`${gen}: unknown option ${JSON.stringify(k)}; it takes ${all.join(', ')}`)
}

export function show(v: unknown): string {
  if (typeof v === 'function') return 'a function'
  if (v === undefined) return 'undefined'
  try {
    return JSON.stringify(v) ?? String(v)
  } catch {
    return String(v)
  }
}

export interface HoleOptions {
  /** drill diameter in mm; the family's datasheet figure by default */
  drill?: number
  /** copper pad: a diameter, or [w, h] in footprint axes, in mm; the family's datasheet figure by default */
  pad?: number | [number, number]
}

// the id suffix, such as "_Drill0.8mm", keeps a house variant from sharing a footprint id with the stock one
export function padArgs(gen: string, drill: unknown, pad: unknown, defDrill: number, defSize: [number, number]): { drill: number; size: [number, number]; suffix: string } {
  if (drill !== undefined) mmArg(gen, 'drill', drill, 'a positive number of mm such as 0.8')
  if (pad !== undefined) sizeArg(gen, 'pad', pad)
  const d = (drill as number | undefined) ?? defDrill
  const size: [number, number] = pad === undefined ? defSize : typeof pad === 'number' ? [pad, pad] : [pad[0], pad[1]]
  if (Math.min(...size) < d + 0.2) throw new RangeError(`${gen}: a ${size[0]} x ${size[1]} mm pad around a ${d} mm drill leaves less than a 0.1 mm ring`)
  let suffix = ''
  if (d !== defDrill) suffix += `_Drill${d}mm`
  if (size[0] !== defSize[0] || size[1] !== defSize[1]) suffix += `_Pad${size[0]}x${size[1]}mm`
  return { drill: d, size, suffix }
}
