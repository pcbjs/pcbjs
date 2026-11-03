// Footprint fixtures as parts: fp() takes the props and pads a bare <footprint> would, makes a part of them named by its ref,
// connects its pins to the nets the props and pads name, and returns the placement; handle('U1.1') is the handle of that pad.
import { h } from '@pcbjs/core/jsx-runtime'
import { defineFootprint, nets, isNode, childList, NC, part } from '@pcbjs/core'
import { beginCompile, endCompile } from '@pcbjs/core/internal/realm'
import { footprintRender } from '@pcbjs/core/internal/footprint'
import { partOf } from '@pcbjs/core/internal/part'

/** The nets of the fixtures by name: `N.GND`. */
export const N = nets()
/** A net from a name, or the Net itself. */
export const netOf = v => (typeof v === 'string' ? N[v] : v)

/** A fixture belongs to no file, so the fixtures of earlier tests never count as declared and unplaced on a later board. */
const loose = p => {
  partOf(p).declFile = undefined
}
const PLACE = new Set(['at', 'side', 'ref:at', 'thermal', 'name', 'at:initial', 'at:cost', 'at:solver', 'at:follow'])
// a factory's placement keeps the range of the call; a bare footprint's range is its own element's
const PLACE_CALL = new Set([...PLACE, '__src'])
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
  for (const p of pads) if (p.net !== undefined && p.net !== null) conn[p.pin] = netOf(p.net)
  for (const [k, v] of Object.entries(keys)) {
    const alias = /^pad(\d+)$/.exec(k)
    const pad = pads.find(p => p.num === k) ?? pads.find(p => p.pin === k) ?? (alias ? pads.find(p => p.num === alias[1]) : undefined)
    if (!pad) throw new Error(`fixture ${ref}: no pad ${k}`)
    conn[pad.pin] = netOf(v)
  }
  // a pad a bare footprint left on no net stays on none
  if (Object.keys(conn).length) part.connect(Object.fromEntries(pins.map(q => [q, conn[q] ?? NC])))
  loose(part)
  parts.set(ref, part)
  const node = h(part, place)
  Object.defineProperty(node, 'part', { value: part })
  return node
}

/** The handle of a fixture pad, `handle('U1.1')`, read from the latest fixture of that ref when the board compiles, so it may be written before the part. */
export function handle(end) {
  const dot = end.indexOf('.')
  const ref = end.slice(0, dot),
    key = end.slice(dot + 1)
  // before the part is made, enough of a handle for route() to take it
  const early = { $$: 'pin', pin: key }
  const handle = () => (parts.has(ref) ? parts.get(ref)[key] : early)
  return new Proxy({}, { get: (_, k) => Reflect.get(handle(), k), has: (_, k) => k in handle() })
}

/** An instance of a circuit made here, so it belongs to this module and not to the test file that asks for it. */
export const instance = (c, ports, index) => c(ports, index)

/** A part made here, a module this board places nothing from, as a part of another board is. */
export const elsewhere = (factory, ...args) => factory(...args)

const padsOf = (c, out = []) => {
  const list = childList(c)
  if (list) {
    for (const k of list) padsOf(k, out)
    return out
  }
  if (!isNode(c)) return out
  if (c.type === 'pad')
    out.push({ num: c.props.num === undefined ? '' : String(c.props.num), name: c.props.name === undefined || c.props.name === '' ? undefined : String(c.props.name) })
  else if (typeof c.type === 'function') padsOf(c.type({ ...c.props, ...(c.children.length ? { children: c.children } : {}) }), out)
  else padsOf(c.children, out)
  return out
}

/**
 * A factory's footprint placed as a plain footprint was: `place(PinHeader, { ref: 'J1', pins: 2, at: '2 2', 'net:1': 'A' })`.
 * Footprint props become the part's own, nets connect by pin and every other pin goes to NC, so the board is as it was.
 */
export function place(F, props) {
  const { ref, value, nets: byPad = {}, children, ...rest } = props
  const keys = { ...byPad }
  const fixed = {},
    at = {}
  for (const [k, v] of Object.entries(rest)) {
    if (k.startsWith('net:')) keys[k.slice(4)] = v
    else (PLACE_CALL.has(k) ? at : fixed)[k] = v
  }
  const render = footprintRender(F)
  const pads = padsOf(render({ ...fixed, ref, at: '0 0' }))
  // a plain component declares no pins: its numbered pads are
  const pins = (typeof F.pins === 'function' ? F.pins(fixed) : F.pins) ?? [...new Set(pads.filter(q => q.num !== '').map(q => q.name ?? q.num))]
  const nc = (typeof F.nc === 'function' ? F.nc(fixed) : F.nc) ?? []
  const p = part(render, { pins, nc, prefix: F.prefix ?? /^[A-Za-z_]+/.exec(ref)?.[0] ?? 'U', props: fixed, ref, ...(value !== undefined ? { value } : {}) })
  const pinOf = k => {
    if (pins.includes(k)) return k
    const alias = /^pad(\d+)$/.exec(k)
    const pad = pads.find(q => q.num === k) ?? pads.find(q => q.name === k) ?? (alias ? pads.find(q => q.num === alias[1]) : undefined)
    const pin = pad && (pins.includes(pad.name) ? pad.name : pins.includes(pad.num) ? pad.num : undefined)
    if (pin === undefined) throw new Error(`fixture ${ref}: no pin for ${k}`)
    return pin
  }
  const conn = {}
  for (const [k, v] of Object.entries(keys)) conn[pinOf(k)] = netOf(v)
  if (Object.keys(conn).length) p.connect(Object.fromEntries(pins.map(q => [q, conn[q] ?? NC])))
  loose(p)
  parts.set(ref, p)
  const node = children === undefined ? h(p, at) : h(p, at, children)
  Object.defineProperty(node, 'part', { value: p })
  return node
}

/** A new compile epoch, so the parts and instances an earlier test made and left unplaced are dropped once this file makes one. */
export const fresh = () => endCompile(beginCompile())
