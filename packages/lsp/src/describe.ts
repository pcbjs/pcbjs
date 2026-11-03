import type { Hit } from './detect.js'
import { angleDeg, formatNum, lengthMm, parseAt, parseToken } from '@pcbjs/core/internal/units'
import { canonicalLayer, parsePoint } from './values.js'
import { parsePath, validate } from './path-model.js'

const mm = (n: number | undefined) => (n === undefined ? '?' : `${formatNum(n)} mm`)

/** One short line: the parsed value in mm and degrees, or what the path does. */
export function summary(hit: Hit): string {
  switch (hit.kind) {
    case 'at': {
      const a = parseAt(hit.value)
      if (!a) return 'not an x y [rotation] position'
      return `x ${mm(lengthMm(a.x))}, y ${mm(lengthMm(a.y))}${a.rot ? `, ${formatNum(angleDeg(a.rot) ?? 0)}°` : ''}`
    }
    case 'point': {
      const p = parsePoint(hit.value)
      if (!p) return 'not an x y [layer] point'
      return `x ${mm(lengthMm(p.x))}, y ${mm(lengthMm(p.y))}${p.layer ? ` on ${canonicalLayer(p.layer) ?? p.layer}` : ''}`
    }
    case 'layer': {
      const c = canonicalLayer(hit.value)
      return c ? (c === hit.value ? c : `${hit.value} is ${c}`) : `${hit.value}, not a standard layer name`
    }
    case 'side':
      return hit.value === 'B' ? 'back side, mirrored' : 'front side'
    case 'size':
    case 'width':
    case 'thickness':
    case 'drill':
    case 'length': {
      const t = parseToken(hit.value)
      return `${hit.kind === 'length' ? hit.context.prop : hit.kind} ${mm(t && lengthMm(t))}`
    }
    case 'rotation': {
      const t = parseToken(hit.value)
      return `rotated ${formatNum((t && angleDeg(t)) ?? 0)}°`
    }
    case 'pinRef':
      return `pad ${hit.context.ref}/${hit.value}`
    case 'chainCommand': {
      const m = hit.context.prop
      if (m === 'via') return `a via to ${hit.context.args?.[0]?.replace(/^['"`]|['"`]$/g, '') ?? '?'}`
      if ((m === 'Z' || m === 'X') && !hit.context.args?.length) return `${m === 'Z' ? 'a straight track' : 'an automatic leg'} to the end`
      if (m === 'X' || (m === 'L' && hit.context.args?.length === 1)) return `${m === 'X' ? 'an automatic leg' : 'a straight track'} to ${hit.context.args?.[0]}`
      if (m === 'A' || m === 'a') return `${m === 'a' ? 'relative ' : ''}arc to ${hit.context.args?.slice(0, 2).join(', ')}, turning ${hit.context.args?.[2]}`
      return `${m === m.toLowerCase() ? 'relative ' : ''}${m.toUpperCase() === 'L' ? 'line' : m.toUpperCase() === 'H' ? 'horizontal' : 'vertical'} to ${hit.context.args?.join(', ')}`
    }
    case 'number':
      return hit.context.prop === 'impedance' ? `${hit.value} ohm` : `${hit.context.prop} ${hit.value}`
    case 'svgPath': {
      const { rows, errors } = parsePath(hit.value)
      const errs = errors.length ? errors : validate(rows)
      const parts = [`${rows.length} command${rows.length === 1 ? '' : 's'}`]
      if (errs.length) parts.push(`error: ${errs[0]}`)
      return parts.join(', ')
    }
  }
}
