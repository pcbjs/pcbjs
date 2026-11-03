// Footprint fixtures as parts: fp() takes the props and pads a bare <footprint> would, makes a part of them named by its ref,
// connects its pins to the nets the props and pads name, and returns the placement; P('U1.1') is the handle of that pad.
import { h } from '@pcbjs/core/jsx-runtime'
import { defineFootprint, nets, isNode, childList, NC } from '@pcbjs/core'

/** The nets of the fixtures by name: `N.GND`. */
export const N = nets()
/** A net from a name, or the Net itself. */
export const net = v => (typeof v === 'string' ? N[v] : v)

const PLACE = new Set(['at', 'side', 'ref:at', 'thermal'])
const parts = new Map()

/** The pads of a tree with their `net` taken off, and each pad's pin and net. */
function strip(c, out) {
  const list = childList(c)
  if (list) return list.map(k => strip(k, out))
  if (!isNode(c)) return c
  if (c.type === 'pad') {
    const { net: n, ...p } = c.props
    const num = p.num === undefined || p.num === null ? '' : String(p.num)
    if (num !== '' && p.type !== 'npth' && !p.nc) out.push({ num, pin: p.name !== undefined && p.name !== '' ? String(p.name) : num, net: n })
    return h('pad', p, ...c.children)
  }
  return { ...c, children: c.children.map(k => strip(k, out)) }
}

/** A part placed like a bare footprint: `fp({ ref: 'U1', at: '5 5', nets: { 1: 'GND' } }, h('pad', …))`. */
export function fp(props, ...children) {
  const { ref, nets: byPad = {}, children: own, ...rest } = props
  const pads = []
  const kids = strip([...children, ...(own === undefined ? [] : [own])], pads)
  const keys = { ...byPad }
  for (const k of Object.keys(rest)) if (k.startsWith('net:')) keys[k.slice(4)] = rest[k]
  const fixed = {},
    place = {}
  for (const [k, v] of Object.entries(rest)) if (!k.startsWith('net:')) (PLACE.has(k) ? place : fixed)[k] = v
  const pins = [...new Set(pads.map(p => p.pin))]
  const F = defineFootprint(
    function Fixture(p) {
      return h('footprint', { ...fixed, ...p }, ...kids)
    },
    { pins, prefix: /^[A-Za-z_]+/.exec(ref)?.[0] ?? 'U' },
  )
  const part = F({ ref })
  const conn = {}
  for (const p of pads) if (p.net !== undefined && p.net !== null) conn[p.pin] = net(p.net)
  for (const [k, v] of Object.entries(keys)) {
    const alias = /^pad(\d+)$/.exec(k)
    const pad = pads.find(p => p.num === k) ?? pads.find(p => p.pin === k) ?? (alias ? pads.find(p => p.num === alias[1]) : undefined)
    if (!pad) throw new Error(`fixture ${ref}: no pad ${k}`)
    conn[pad.pin] = net(v)
  }
  // a pad a bare footprint left on no net stays on none
  if (Object.keys(conn).length) part.connect(Object.fromEntries(pins.map(q => [q, conn[q] ?? NC])))
  parts.set(ref, part)
  const node = h(part, place)
  Object.defineProperty(node, 'part', { value: part })
  return node
}

/** The handle of a fixture pad, `P('U1.1')`; anything else as it is. */
export function P(end) {
  if (typeof end !== 'string') return end
  const dot = end.indexOf('.')
  const part = dot > 0 ? parts.get(end.slice(0, dot)) : undefined
  return part ? part[end.slice(dot + 1)] : end
}

/** An instance of a circuit made here, so it belongs to this module and not to the test file that asks for it. */
export const instance = (c, ports, index) => c(ports, index)

/** A part made here, a module this board places nothing from, as a part of another board is. */
export const elsewhere = (factory, ...args) => factory(...args)
