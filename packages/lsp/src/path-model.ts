// SVG path data, as `d` on `<path>` and the shape helpers write it.

import { NUM_RE, formatNum } from '@pcbjs/core/internal/units'

export interface Row {
  /** The command as written: M, L, H, V, C, S, Q, T, A, Z in either case. */
  cmd: string
  /** Number arguments as written. */
  args: string[]
  /** Offset of the command's letter, or of its first number for an implicit repeat; `end` is after its last argument. */
  start?: number
  end?: number
}

export interface Parsed {
  rows: Row[]
  /** Problems found while reading the string; the rows hold what could be read. */
  errors: string[]
}

const ARITY: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, Z: 0, C: 6, S: 4, Q: 4, T: 2, A: 7 }

export function arity(cmd: string): number {
  return ARITY[cmd.toUpperCase()] ?? 0
}

/** The commands a row may switch to, in menu order. */
export function commands(): string[] {
  return ['M', 'm', 'L', 'l', 'H', 'h', 'V', 'v', 'C', 'c', 'S', 's', 'Q', 'q', 'T', 't', 'A', 'a', 'Z']
}

/** Read a path leniently: every command becomes one row, implicit repeats become rows of their own. */
export function parsePath(src: string): Parsed {
  const rows: Row[] = []
  const errors: string[] = []
  let i = 0
  const skip = () => {
    while (i < src.length && /[\s,]/.test(src[i])) i++
  }
  let cur: string | undefined
  while (true) {
    skip()
    if (i >= src.length) break
    const c = src[i]
    const at = i
    if (/[A-Za-z]/.test(c)) {
      i++
      if (!(c.toUpperCase() in ARITY)) {
        errors.push(`unknown command ${c} at character ${i}`)
        cur = undefined
        continue
      }
      cur = c
      if (arity(c) === 0) {
        rows.push({ cmd: c, args: [], start: at, end: i })
        cur = undefined
        continue
      }
      readArgs(c, at)
      continue
    }
    if (NUM_RE.test(src.slice(i)) && cur) {
      // An implicit repeat; after M it is L, as in SVG.
      readArgs(cur === 'M' ? 'L' : cur === 'm' ? 'l' : cur, at)
      continue
    }
    errors.push(`unexpected ${JSON.stringify(c)} at character ${i + 1}`)
    i++
  }
  return { rows, errors }

  function readArgs(cmd: string, at: number): void {
    const args: string[] = []
    for (let k = 0; k < arity(cmd); k++) {
      skip()
      const m = NUM_RE.exec(src.slice(i))
      if (!m) {
        errors.push(`${cmd} expects ${arity(cmd)} numbers, found ${k}, at character ${i + 1}`)
        break
      }
      i += m[0].length
      args.push(m[0])
    }
    while (args.length < arity(cmd)) args.push('')
    rows.push({ cmd, args, start: at, end: i })
    cur = cmd
  }
}

/** Every reason the rows would not compile, empty when they are fine. */
export function validate(rows: Row[]): string[] {
  const errs: string[] = []
  rows.forEach((r, i) => {
    const n = `row ${i + 1}`
    const up = r.cmd.toUpperCase()
    if (!(up in ARITY)) return errs.push(`${n}: unknown command ${r.cmd}`)
    if (i === 0 && up !== 'M') errs.push(`${n}: SVG path data starts with M`)
    if (r.args.length !== arity(r.cmd)) errs.push(`${n}: ${r.cmd} takes ${arity(r.cmd)} numbers`)
    r.args.forEach((a, k) => {
      const m = NUM_RE.exec(a.trim())
      if (!m || m[0].length !== a.trim().length) errs.push(`${n}: argument ${k + 1} of ${r.cmd} is not a number: ${JSON.stringify(a)}`)
    })
  })
  return errs
}

export function serialise(rows: Row[]): string {
  return rows.map(r => [r.cmd, ...r.args.map(a => a.trim())].join(' ')).join(' ')
}

/** The absolute cursor after row i. */
export function cursorAfter(rows: Row[], i: number): { x: number; y: number } | undefined {
  let p: { x: number; y: number } | undefined = { x: 0, y: 0 }
  let start: { x: number; y: number } | undefined = p
  for (let k = 0; k <= i && k < rows.length; k++) {
    const r = rows[k]
    const a = r.args.map(Number)
    const rel = r.cmd !== r.cmd.toUpperCase()
    const up = r.cmd.toUpperCase()
    if (up === 'H') p = rel ? p && { x: p.x + a[0], y: p.y } : p && { x: a[0], y: p.y }
    else if (up === 'V') p = rel ? p && { x: p.x, y: p.y + a[0] } : p && { x: p.x, y: a[0] }
    else if (up === 'Z') p = start
    else if (a.length >= 2) {
      const x = a[a.length - 2]
      const y = a[a.length - 1]
      p = rel ? p && { x: p.x + x, y: p.y + y } : { x, y }
      if (up === 'M') start = p
    }
    if (p && (!Number.isFinite(p.x) || !Number.isFinite(p.y))) p = undefined
  }
  return p
}

// edits: each returns new rows and leaves its input alone

export function setArg(rows: Row[], i: number, j: number, value: string): Row[] {
  return rows.map((r, k) => (k === i ? { cmd: r.cmd, args: r.args.map((a, m) => (m === j ? value.trim() : a)) } : r))
}

/** Default arguments for a new command after row `after`: the cursor for absolute commands, zero for relative ones. */
function defaults(rows: Row[], after: number, cmd: string): string[] {
  const n = arity(cmd)
  if (!n) return []
  const rel = cmd !== cmd.toUpperCase()
  const p = after >= 0 ? cursorAfter(rows, after) : { x: 0, y: 0 }
  if (rel || !p) return Array(n).fill('0')
  const up = cmd.toUpperCase()
  if (up === 'H') return [formatNum(p.x)]
  if (up === 'V') return [formatNum(p.y)]
  const out = Array(n).fill('0')
  if (up === 'A') out.splice(0, 2, '1', '1')
  out[n - 2] = formatNum(p.x)
  out[n - 1] = formatNum(p.y)
  return out
}

/** Insert a command after row `after`, -1 for the front. */
export function insertRow(rows: Row[], after: number, cmd: string): Row[] {
  const out = rows.slice()
  out.splice(after + 1, 0, { cmd, args: defaults(rows, after, cmd) })
  return out
}

export function deleteRow(rows: Row[], i: number): Row[] {
  return rows.filter((_, k) => k !== i)
}

/** Change the command of a row, carrying over the numbers that still mean the same. */
export function setCommand(rows: Row[], i: number, cmd: string): Row[] {
  const r = rows[i]
  if (!r) return rows
  const fresh = defaults(rows, i - 1, cmd)
  const from = r.cmd.toUpperCase()
  const to = cmd.toUpperCase()
  let args = fresh
  if (arity(cmd) === r.args.length) args = r.args.slice()
  else if (to === 'H' && from === 'L') args = [r.args[0]]
  else if (to === 'V' && from === 'L') args = [r.args[1]]
  else if (to === 'L' && from === 'H') args = [r.args[0], fresh[1] ?? '0']
  else if (to === 'L' && from === 'V') args = [fresh[0] ?? '0', r.args[0]]
  return rows.map((row, k) => (k === i ? { cmd, args } : row))
}
