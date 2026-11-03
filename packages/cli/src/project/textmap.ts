// A position in one version of a text as the same position in the next: lines matched by their longest common subsequence,
// a changed block of as many lines paired line by line, and a column moved by the edit within its line.
import { diffEdit } from '@pcbjs/core/internal/textdoc'

type Point = [number, number]

/** line, column, both from 1, in `a` to the same place in `b`; null inside an edit or on a line with no counterpart */
export type PointMap = (at: Point) => Point | null

/** Above this many cells the middle of the two texts is paired as one block. */
const MAX_CELLS = 4_000_000

/** Index pairs of equal lines, increasing in both. */
function matches(a: string[], b: string[]): [number, number][] {
  let s = 0
  while (s < a.length && s < b.length && a[s] === b[s]) s++
  let e = 0
  while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++
  const out: [number, number][] = []
  for (let i = 0; i < s; i++) out.push([i, i])
  const n = a.length - s - e,
    m = b.length - s - e
  if (n && m && n * m <= MAX_CELLS) out.push(...lcs(a.slice(s, s + n), b.slice(s, s + m)).map(([i, j]): [number, number] => [i + s, j + s]))
  for (let k = e; k > 0; k--) out.push([a.length - k, b.length - k])
  return out
}

function lcs(a: string[], b: string[]): [number, number][] {
  const n = a.length,
    m = b.length
  const t = new Uint32Array((n + 1) * (m + 1))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) t[i * (m + 1) + j] = a[i] === b[j] ? t[(i + 1) * (m + 1) + j + 1] + 1 : Math.max(t[(i + 1) * (m + 1) + j], t[i * (m + 1) + j + 1])
  const out: [number, number][] = []
  for (let i = 0, j = 0; i < n && j < m;) {
    if (a[i] === b[j]) out.push([i++, j++])
    else if (t[(i + 1) * (m + 1) + j] >= t[i * (m + 1) + j + 1]) i++
    else j++
  }
  return out
}

/** A column before the line's edit stays, one after it moves by the edit's length change, one inside has no image. */
function mapColumn(x: string, y: string, col: number): number | null {
  const d = diffEdit(x, y)
  const o = col - 1
  if (o <= d.start) return col
  if (o >= d.end) return col + y.length - x.length
  return null
}

/** Two lines are one edited line when what they share at both ends is at least half the longer. */
function similar(x: string, y: string): boolean {
  const d = diffEdit(x, y)
  const shared = d.start + x.length - d.end
  return 2 * shared >= Math.max(x.length, y.length) && shared > 0
}

export function pointMap(before: string, after: string): PointMap {
  const a = before.split('\n'),
    b = after.split('\n')
  const line = new Map<number, number>()
  const pairs = matches(a, b)
  for (const [i, j] of pairs) line.set(i, j)
  // the blocks between matches: one of as many lines on both sides pairs line by line, another pairs similar lines in order
  const bounds: [number, number][] = [[-1, -1], ...pairs, [a.length, b.length]]
  for (let k = 0; k + 1 < bounds.length; k++) {
    const [i0, j0] = bounds[k],
      [i1, j1] = bounds[k + 1]
    if (i1 - i0 === j1 - j0) for (let d = 1; i0 + d < i1; d++) line.set(i0 + d, j0 + d)
    else
      for (let i = i0 + 1, j = j0 + 1; i < i1; i++) {
        const hit = b.slice(j, j1).findIndex(y => similar(a[i], y))
        if (hit < 0) continue
        line.set(i, j + hit)
        j += hit + 1
      }
  }
  return ([l, c]) => {
    const j = line.get(l - 1)
    if (j === undefined) return null
    const col = a[l - 1] === b[j] ? c : mapColumn(a[l - 1], b[j], c)
    return col === null ? null : [j + 1, col]
  }
}
