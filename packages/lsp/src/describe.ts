import type { Hit } from './detect.js'
import { angleDeg, canonicalLayer, formatNum, lengthMm, parseAt, parsePoint, parseToken } from './values.js'
import { ending, parsePath, validate } from './path-model.js'

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
      return /^(b|bottom|back)$/i.test(hit.value) ? 'back side, mirrored' : 'front side'
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
      return `pad ${hit.context.form === 'dotted' ? hit.value : `${hit.context.ref}.${hit.value}`}`
    case 'chainCommand': {
      const m = hit.context.prop
      if (m === 'via') return `a via to ${hit.context.args?.[0]?.replace(/^['"`]|['"`]$/g, '') ?? '?'}`
      if (m === 'Z' || m === 'X') return `${m === 'Z' ? 'a straight track' : 'an automatic leg'} to ${hit.context.args?.[0] ?? '?'}`
      return `${m === m.toLowerCase() ? 'relative ' : ''}${m.toUpperCase() === 'L' ? 'line' : m.toUpperCase() === 'H' ? 'horizontal' : 'vertical'} to ${hit.context.args?.join(', ')}`
    }
    case 'copper':
      return `${hit.value} copper layers`
    case 'number':
      return hit.context.prop === 'impedance' ? `${hit.value} ohm` : `${hit.context.prop} ${hit.value}`
    case 'routePath':
    case 'svgPath': {
      const grammar = hit.kind === 'routePath' ? 'route' : 'svg'
      const { rows, errors } = parsePath(hit.value, grammar)
      const errs = errors.length ? errors : validate(rows, grammar)
      if (grammar === 'route' && !rows.length) return 'autorouted the whole way'
      const vias = rows.filter(r => r.cmd === '@').length
      const end = ending(rows)
      const parts = [`${rows.length} command${rows.length === 1 ? '' : 's'}`]
      if (grammar === 'route') {
        if (vias) parts.push(`${vias} via${vias === 1 ? '' : 's'}`)
        if (end) parts.push(end === 'XZ' ? 'autorouted to b' : 'straight to b')
      }
      if (errs.length) parts.push(`error: ${errs[0]}`)
      return parts.join(', ')
    }
  }
}
