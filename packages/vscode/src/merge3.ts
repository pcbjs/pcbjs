// A line-wise three-way merge without vscode: the base, the editor's text and the disk's. Unchanged on one side takes the other; the
// same change on both is taken once; different changes to one region are a conflict.

export interface Merged {
  text: string
  conflicts: number
  /** for each line of ours, its line in `text`; -1 where a conflict replaced it */
  lines: number[]
}

/** Lines with their endings, so joining them gives the text back. */
export const splitLines = (text: string): string[] => (text ? text.split(/(?<=\n)/) : [])

/** Cells past which the middle of two texts is one change, not diffed line by line. */
const MAX_CELLS = 4_000_000

interface Hunk {
  /** the replaced lines of the base, [baseStart, baseEnd) */
  baseStart: number
  baseEnd: number
  /** their replacement in the other text */
  start: number
  end: number
}

/** The changes from a to b, by the longest common subsequence of lines. */
export function hunks(a: string[], b: string[]): Hunk[] {
  let pre = 0
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++
  let suf = 0
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++
  const n = a.length - pre - suf
  const m = b.length - pre - suf
  if (!n && !m) return []
  if (!n || !m || n * m > MAX_CELLS) return [{ baseStart: pre, baseEnd: pre + n, start: pre, end: pre + m }]
  // lengths of the common subsequence of the suffixes, row by row
  const w = m + 1
  const len = new Uint32Array((n + 1) * w)
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) len[i * w + j] = a[pre + i] === b[pre + j] ? len[(i + 1) * w + j + 1] + 1 : Math.max(len[(i + 1) * w + j], len[i * w + j + 1])
  const out: Hunk[] = []
  let i = 0
  let j = 0
  let open: Hunk | null = null
  const close = () => {
    if (open) out.push(open)
    open = null
  }
  while (i < n || j < m) {
    if (i < n && j < m && a[pre + i] === b[pre + j]) {
      close()
      i++
      j++
      continue
    }
    open ??= { baseStart: pre + i, baseEnd: pre + i, start: pre + j, end: pre + j }
    if (j < m && (i === n || len[i * w + j + 1] >= len[(i + 1) * w + j])) open.end = pre + ++j
    else open.baseEnd = pre + ++i
  }
  close()
  return out
}

export interface MergeLabels {
  ours: string
  theirs: string
}

/** Merge ours and theirs from base; a conflict gets the usual markers, ours first. */
export function merge3(base: string, ours: string, theirs: string, labels: MergeLabels = { ours: 'editor', theirs: 'disk' }): Merged {
  const b = splitLines(base)
  const o = splitLines(ours)
  const t = splitLines(theirs)
  const ho = hunks(b, o).map(h => ({ ...h, side: 'o' as const }))
  const ht = hunks(b, t).map(h => ({ ...h, side: 't' as const }))
  const all = [...ho, ...ht].sort((x, y) => x.baseStart - y.baseStart || x.baseEnd - y.baseEnd)
  const out: string[] = []
  const lines = new Array<number>(o.length).fill(-1)
  let conflicts = 0
  // base line `at` maps to ours and theirs through the hunks before it
  let at = 0
  let shiftO = 0
  let shiftT = 0
  const stable = (to: number) => {
    for (; at < to; at++) {
      lines[at + shiftO] = out.length
      out.push(b[at])
    }
  }
  for (let k = 0; k < all.length;) {
    // a group: hunks whose base ranges overlap, or insertions at one point; a change beside the other side's applies after it
    const lo = all[k].baseStart
    let hi = all[k].baseEnd
    const group = [all[k++]]
    const insertsAt = (h: Hunk) => h.baseStart === h.baseEnd && group.some(g => g.baseStart === g.baseEnd && g.baseStart === h.baseStart)
    while (k < all.length && (all[k].baseStart < hi || insertsAt(all[k]))) {
      hi = Math.max(hi, all[k].baseEnd)
      group.push(all[k++])
    }
    stable(lo)
    const side = (s: 'o' | 't', text: string[], shift: number) => {
      const hs = group.filter(g => g.side === s)
      if (!hs.length) return { start: lo + shift, end: hi + shift, text: text.slice(lo + shift, hi + shift), changed: false }
      const first = hs[0]
      const last = hs[hs.length - 1]
      const start = first.start - (first.baseStart - lo)
      const end = last.end + (hi - last.baseEnd)
      return { start, end, text: text.slice(start, end), changed: true }
    }
    const so = side('o', o, shiftO)
    const st = side('t', t, shiftT)
    const same = so.text.length === st.text.length && so.text.every((l, i) => l === st.text[i])
    if (!st.changed || same) {
      for (let i = so.start; i < so.end; i++) lines[i] = out.length + i - so.start
      out.push(...so.text)
    } else if (!so.changed) out.push(...st.text)
    else {
      conflicts++
      const nl = (ls: string[]) => (ls.length && !ls[ls.length - 1].endsWith('\n') ? [...ls.slice(0, -1), ls[ls.length - 1] + '\n'] : ls)
      out.push(`<<<<<<< ${labels.ours}\n`, ...nl(so.text), '=======\n', ...nl(st.text), `>>>>>>> ${labels.theirs}\n`)
    }
    shiftO = so.end - hi
    shiftT = st.end - hi
    at = hi
  }
  stable(b.length)
  return { text: out.join(''), conflicts, lines }
}
