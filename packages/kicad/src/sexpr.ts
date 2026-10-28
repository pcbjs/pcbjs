/** An atom or a list; numbers stay strings until read, so `"1"` and `1` read the same. */
export type SExpr = string | SList
export interface SList extends Array<SExpr> {}

export class SExprError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SExprError'
  }
}

/** Parse one s-expression, the whole file. */
export function parseSExpr(text: string): SList {
  let i = 0
  const n = text.length
  const stack: SList[] = []
  let root: SList | null = null
  const line = () => text.slice(0, i).split('\n').length
  while (i < n) {
    const c = text[i]
    if (c === '(') {
      const l: SList = []
      if (stack.length) stack[stack.length - 1].push(l)
      else if (root) throw new SExprError(`more than one top-level list, line ${line()}`)
      else root = l
      stack.push(l)
      i++
    } else if (c === ')') {
      if (!stack.length) throw new SExprError(`unbalanced ")" at line ${line()}`)
      stack.pop()
      i++
    } else if (c === '"') {
      let s = ''
      i++
      while (i < n && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < n) {
          const e = text[i + 1]
          s += e === 'n' ? '\n' : e === 't' ? '\t' : e
          i += 2
        } else s += text[i++]
      }
      if (i >= n) throw new SExprError('unterminated string')
      i++
      if (!stack.length) throw new SExprError(`an atom outside any list at line ${line()}`)
      stack[stack.length - 1].push(s)
    } else if (c === ' ' || c === '\n' || c === '\t' || c === '\r') i++
    else {
      let j = i
      while (j < n && !' \n\t\r()"'.includes(text[j])) j++
      if (!stack.length) throw new SExprError(`an atom outside any list at line ${line()}`)
      stack[stack.length - 1].push(text.slice(i, j))
      i = j
    }
  }
  if (stack.length) throw new SExprError('unbalanced "(": the file ends inside a list')
  if (!root) throw new SExprError('no s-expression in the input')
  return root
}

export const isList = (e: SExpr | undefined): e is SList => Array.isArray(e)
/** The head symbol of a list, '' for an atom or an empty list. */
export const head = (e: SExpr | undefined): string => (isList(e) && typeof e[0] === 'string' ? e[0] : '')

export function child(l: SList | undefined, name: string): SList | undefined {
  if (!l) return undefined
  for (const e of l) if (isList(e) && e[0] === name) return e
  return undefined
}
export function children(l: SList | undefined, name: string): SList[] {
  if (!l) return []
  return l.filter((e): e is SList => isList(e) && e[0] === name)
}
export function atom(l: SList | undefined, i = 1): string | undefined {
  const v = l?.[i]
  return typeof v === 'string' ? v : undefined
}
export function num(l: SList | undefined, i = 1, fallback = NaN): number {
  const v = atom(l, i)
  if (v === undefined) return fallback
  const x = Number(v)
  return Number.isFinite(x) ? x : fallback
}
/** The numbers of a child list such as (at 1 2 90): [1, 2, 90]. */
export function nums(l: SList | undefined, name: string): number[] {
  const c = child(l, name)
  return c
    ? c
        .slice(1)
        .filter((v): v is string => typeof v === 'string')
        .map(Number)
        .filter(Number.isFinite)
    : []
}
/** A yes/no flag: `(hide yes)`, a bare `hide` symbol among the atoms, or `(hide)`. */
export function flag(l: SList | undefined, name: string): boolean {
  if (!l) return false
  for (const e of l) {
    if (e === name) return true
    if (isList(e) && e[0] === name) return e.length === 1 || e[1] === 'yes' || e[1] === 'true'
  }
  return false
}
export const atoms = (l: SList | undefined): string[] => (l ? l.slice(1).filter((v): v is string => typeof v === 'string') : [])
