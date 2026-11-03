// Source map v3 lookups for the browser compile: a stack frame of a bundled design module back to its source, as Vite's stack rewriting does in Node.

export interface SourceMapV3 {
  version: number
  sources: string[]
  mappings: string
  sourceRoot?: string
}

/** One position, line and column from 1 as V8 stack frames give them. */
export interface Position {
  file: string
  line: number
  col: number
}

const B64 = new Map([...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'].map((c, i) => [c, i]))

/** The VLQ numbers of one segment. */
function vlq(seg: string): number[] {
  const out: number[] = []
  let v = 0,
    shift = 0
  for (const c of seg) {
    const d = B64.get(c) ?? 0
    v += (d & 31) << shift
    if (d & 32) shift += 5
    else {
      out.push(v & 1 ? -(v >>> 1) : v >>> 1)
      v = shift = 0
    }
  }
  return out
}

/** Per generated line, its segments as [column, source, line, column], all from 0, by ascending column. */
function decode(mappings: string): number[][][] {
  let src = 0,
    line = 0,
    col = 0
  return mappings.split(';').map(text => {
    let gen = 0
    const segs: number[][] = []
    for (const s of text.split(',')) {
      if (!s) continue
      const n = vlq(s)
      gen += n[0]
      if (n.length < 4) continue
      src += n[1]
      line += n[2]
      col += n[3]
      segs.push([gen, src, line, col])
    }
    return segs.sort((a, b) => a[0] - b[0])
  })
}

/** The source of a generated position, by the nearest segment at or before it on its line; null outside every mapped range. */
export function sourceMapper(map: SourceMapV3): (line: number, col: number) => Position | null {
  const lines = decode(map.mappings)
  const root = map.sourceRoot ? map.sourceRoot.replace(/\/?$/, '/') : ''
  return (line, col) => {
    const segs = lines[line - 1]
    if (!segs?.length) return null
    let lo = 0,
      hi = segs.length - 1,
      at = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (segs[mid][0] <= col - 1) {
        at = mid
        lo = mid + 1
      } else hi = mid - 1
    }
    if (at < 0) return null
    const [, s, l, c] = segs[at]
    return { file: root + map.sources[s], line: l + 1, col: c + 1 }
  }
}
