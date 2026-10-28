import { toInjected, toSource, type ScopeInjection } from '@pcbjs/compile/scope'

export type Inj = ScopeInjection | null | undefined
export interface Span {
  start: number
  length: number
}

export const DROP = Symbol('drop')

/** True for a span wholly in the inserted text; an empty span on either edge of it is outside. */
export function inside(inj: Inj, start: number, length: number): boolean {
  if (!inj) return false
  const end = inj.at + inj.text.length
  return length ? start >= inj.at && start + length <= end : start > inj.at && start < end
}

export const into = (inj: Inj, pos: number) => toInjected(inj, pos)
/** The end of a range: one ending at the insertion stays before it. */
export const intoEnd = (inj: Inj, pos: number) => (inj && pos <= inj.at ? pos : toInjected(inj, pos))
export const out = (inj: Inj, pos: number) => toSource(inj, pos)

export function outSpan(inj: Inj, s: Span): Span | null {
  if (!inj) return s
  if (inside(inj, s.start, s.length)) return null
  const start = out(inj, s.start)
  return { start, length: out(inj, s.start + s.length) - start }
}

export const intoSpan = (inj: Inj, s: Span): Span => {
  const start = into(inj, s.start)
  return { start, length: intoEnd(inj, s.start + s.length) - start }
}

const isSpan = (v: any): v is Span => typeof v.start === 'number' && typeof v.length === 'number' && Object.keys(v).length === 2

/** Keys whose span in the inserted text means the item is about injected code. */
const OWN = new Set(['textSpan', 'span', 'triggerSpan', 'nameSpan', 'selectionSpan'])

/** Maps a language service result from injected to source offsets, dropping items inside the inserted text. */
export function outResult(v: any, file: string | undefined, injOf: (f: string) => Inj): any {
  if (Array.isArray(v)) return v.map(x => outResult(x, file, injOf)).filter(x => x !== DROP)
  if (!v || typeof v !== 'object') return v
  // compiler objects such as nodes, symbols and source files are class instances
  const proto = Object.getPrototypeOf(v)
  if (proto !== Object.prototype && proto !== null) return v
  if (typeof v.fileName === 'string') file = v.fileName
  const inj = file ? injOf(file) : null
  if (isSpan(v)) return outSpan(inj, v) ?? DROP
  const o: any = { ...v }
  for (const k of Object.keys(o)) {
    const x = o[k]
    if (typeof x === 'number' && (k === 'position' || k === 'renameLocation')) {
      const at = k === 'renameLocation' && typeof o.renameFilename === 'string' ? injOf(o.renameFilename) : inj
      if (k === 'position' && inside(at, x, 0)) return DROP
      o[k] = out(at, x)
    } else if (x && typeof x === 'object') {
      const m = outResult(x, file, injOf)
      if (m !== DROP) o[k] = m
      else if (OWN.has(k)) return DROP
      else delete o[k]
    }
  }
  return o
}

/** The line starts of a text, as TypeScript counts lines. */
export function lineStarts(text: string): number[] {
  const out = [0]
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c === 13 && text.charCodeAt(i + 1) === 10) i++
    if (c === 10 || c === 13 || c === 0x2028 || c === 0x2029) out.push(i + 1)
  }
  return out
}
