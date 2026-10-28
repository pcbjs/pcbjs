// route(a, b, path): SVG line commands L H V Z from `a` to `b`, plus X and XZ for automatic legs and @layer for a via.
import type { RouteStep } from '@pcbjs/core/model'

const NUM = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/i

/** Parse a route path. `layer` resolves the layer name of @ or U. Throws a plain Error naming the position. */
export function parseRoutePath(src: string, layer: (name: string) => string = n => n): RouteStep[] {
  const out: RouteStep[] = []
  let i = 0
  const at = () => `at character ${i + 1} of ${JSON.stringify(src)}`
  const skip = () => {
    while (i < src.length && /[\s,]/.test(src[i])) i++
  }
  const num = (): number => {
    skip()
    const m = NUM.exec(src.slice(i))
    if (!m) throw new Error(`route path: expected a number ${at()}`)
    i += m[0].length
    return parseFloat(m[0])
  }
  const more = () => {
    skip()
    return i < src.length && NUM.test(src.slice(i))
  }
  skip()
  if (i >= src.length) return [{ op: 'XZ' }]
  // each step records its source characters: the letter through its last number, or the numbers of a repeat
  let from = 0
  const push = (st: RouteStep) => {
    out.push({ ...st, at: [from, i] })
    from = i
  }
  while (true) {
    skip()
    if (i >= src.length) break
    from = i
    const c = src[i]
    if (!/[A-Za-z@]/.test(c)) throw new Error(`route path: expected a command ${at()}`)
    if (out.length && (out[out.length - 1].op === 'Z' || out[out.length - 1].op === 'XZ'))
      throw new Error(`route path: ${out[out.length - 1].op} ends the route at b, nothing may follow it, ${at()}`)
    i++
    switch (c) {
      case 'M':
      case 'm':
        throw new Error(`route path: the path starts at a, leave out the ${c} ${at()}`)
      case 'A':
      case 'a':
      case 'C':
      case 'c':
      case 'Q':
      case 'q':
      case 'S':
      case 's':
      case 'T':
      case 't':
        throw new Error(`route path: ${c} is a curve, a route path takes only L, H, V, X, @, Z and XZ, ${at()}`)
      case 'L':
      case 'l':
      case 'X':
      case 'x': {
        const rel = c === 'l' || c === 'x',
          op = c.toUpperCase() as 'L' | 'X'
        skip()
        if (op === 'X' && /[Zz]/.test(src[i] ?? '')) {
          i++
          push({ op: 'XZ' })
          break
        }
        do {
          const x = num(),
            y = num()
          push({ op, x, y, rel })
        } while (more() && ((from = i), true))
        break
      }
      case 'H':
      case 'h':
        do push({ op: 'H', x: num(), rel: c === 'h' })
        while (more() && ((from = i), true))
        break
      case 'V':
      case 'v':
        do push({ op: 'V', y: num(), rel: c === 'v' })
        while (more() && ((from = i), true))
        break
      case '@': {
        while (i < src.length && /\s/.test(src[i])) i++
        // a lone command letter or XZ after @ is the next command, not a layer
        const m = /^[A-Za-z0-9._]+/.exec(src.slice(i))
        if (!m || /^(?:[A-Za-z]|XZ)$/i.test(m[0])) throw new Error(`route path: @ needs a layer, for example @B.Cu, ${at()}`)
        i += m[0].length
        push({ op: 'U', layer: layer(m[0]) })
        break
      }
      case 'U':
      case 'u': {
        skip()
        const m = /^[^\s,]+/.exec(src.slice(i))
        if (!m) throw new Error(`route path: U needs a layer name ${at()}`)
        i += m[0].length
        push({ op: 'U', layer: layer(m[0]) })
        break
      }
      case 'Z':
      case 'z':
        push({ op: 'Z' })
        break
      default:
        throw new Error(`route path: unknown command ${c} ${at()}, a route path takes L, H, V, X, @, Z and XZ`)
    }
  }
  const last = out[out.length - 1]
  if (!last || (last.op !== 'Z' && last.op !== 'XZ')) throw new Error(`route path: ${JSON.stringify(src)} must end at b, with Z for a straight track or XZ for an automatic leg`)
  return out
}
