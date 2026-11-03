// Test fixtures: a footprint drawn inline becomes a part of its own, named by `ref`, its pads connected from `nets` and pad `net`.
import { h, nets, defineFootprint, isNet, isNode, childList, NC } from '@pcbjs/core'

export const N = nets()
/** A net by name, `net('GND')`; a Net passes through. */
export const net = n => (isNet(n) || n === null || n === undefined ? n : N[n])

const PLACE = ['at', 'side', 'ref:at', 'thermal']

/** The pad nodes among children, nested lists included. */
function padsIn(children) {
  const out = []
  const walk = c => {
    const list = childList(c) ?? (Array.isArray(c) ? c : null)
    if (list) return list.forEach(walk)
    if (isNode(c) && c.type === 'pad') out.push(c)
  }
  children.forEach(walk)
  return out
}

/** `fp({ ref, at, nets, …footprint props }, …children)`: a part whose footprint draws the children, placed; `.type` is the part. */
export function fp(props, ...children) {
  const { ref, nets: map = {}, ...rest } = props
  const place = Object.fromEntries(PLACE.filter(k => rest[k] !== undefined).map(k => [k, rest[k]]))
  const own = Object.fromEntries(Object.entries(rest).filter(([k]) => !PLACE.includes(k) && !k.startsWith('net:')))
  for (const [k, v] of Object.entries(rest)) if (k.startsWith('net:')) map[k.slice(4).replace(/^pad(\d+)$/, '$1')] = v
  const conn = {}
  const pins = []
  const kids = children.map(function strip(c) {
    if (Array.isArray(c)) return c.map(strip)
    if (!isNode(c) || c.type !== 'pad') return c
    const { net: n, ...p } = c.props
    const pin = String(p.name ?? p.num)
    if (n !== undefined) conn[pin] = net(n)
    return { ...c, props: p }
  })
  for (const pad of padsIn(kids)) {
    const p = pad.props
    if (p.nc || p.num === undefined || p.num === '' || p.type === 'npth') continue
    const pin = String(p.name ?? p.num)
    if (!pins.includes(pin)) pins.push(pin)
  }
  for (const [k, v] of Object.entries(map)) {
    const pad = padsIn(kids).find(q => String(q.props.num) === k || String(q.props.name) === k)
    conn[pad ? String(pad.props.name ?? pad.props.num) : k] = net(v)
  }
  const F = defineFootprint(
    function Fixture(p) {
      return h('footprint', { ...own, ...p }, ...kids)
    },
    { pins, prefix: /^[A-Za-z_]+/.exec(ref)?.[0] ?? 'U' },
  )
  const part = F({ ref })
  // pins left out are open, as a drawn footprint's pads were
  if (Object.keys(conn).length) part.connect(Object.fromEntries(pins.map(q => [q, conn[q] ?? NC])))
  return h(part, place)
}

/** A compile whose result the test writes to: PCBJS_FREEZE off for its length. */
export function unfrozen(fn) {
  const was = process.env.PCBJS_FREEZE
  process.env.PCBJS_FREEZE = '0'
  try {
    return fn()
  } finally {
    if (was === undefined) delete process.env.PCBJS_FREEZE
    else process.env.PCBJS_FREEZE = was
  }
}
