// A pair is one object: a pair net lights in full as the primary highlight and the rest of its pair group in full as the secondary one.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { netRoles, pairGroups, routeHover } from '../src/routes.ts'
import { hoverScope, inScope } from '../src/scene/focus.ts'

// TXC to the coupling capacitors as one pair, TX on to the hub as two pairs, a single routed stretch of TXN, and CLK alone
const items = [
  { id: 1, kind: 'track', net: 'TXCP', pair: 'pair:1', role: 'P', width: 0.17 },
  { id: 2, kind: 'track', net: 'TXCN', pair: 'pair:1', role: 'N', width: 0.17 },
  { id: 3, kind: 'pad', net: 'TXCP', ref: 'C1' },
  { id: 4, kind: 'pad', net: 'TXP', ref: 'C1' },
  { id: 5, kind: 'pad', net: 'TXCN', ref: 'C2' },
  { id: 6, kind: 'pad', net: 'TXN', ref: 'C2' },
  { id: 7, kind: 'track', net: 'TXP', pair: 'pair:2', role: 'P', width: 0.17 },
  { id: 8, kind: 'track', net: 'TXN', pair: 'pair:2', role: 'N', width: 0.17 },
  { id: 9, kind: 'track', net: 'TXN', width: 0.17 },
  { id: 10, kind: 'via', net: 'TXN' },
  { id: 11, kind: 'via', net: 'TXP' },
  { id: 12, kind: 'track', net: 'TXP', pair: 'pair:3', role: 'P', width: 0.17 },
  { id: 13, kind: 'track', net: 'TXN', pair: 'pair:3', role: 'N', width: 0.17 },
  { id: 14, kind: 'pad', net: 'TXN', ref: 'U1' },
  { id: 15, kind: 'pad', net: 'TXP', ref: 'U1' },
  { id: 16, kind: 'track', net: 'CLK', width: 0.2 },
  { id: 17, kind: 'pad', net: 'CLK', ref: 'U1' },
]
// the export names both sides of the capacitors in every route of the group
const group = ['TXCP', 'TXCN', 'TXP', 'TXN']
const board = {
  items,
  footprints: [
    { ref: 'C1', pads: [{ net: 'TXCP' }, { net: 'TXP' }] },
    { ref: 'C2', pads: [{ net: 'TXCN' }, { net: 'TXN' }] },
    { ref: 'U1', pads: [{ net: 'TXN' }, { net: 'TXP' }, { net: 'CLK' }] },
  ],
  routes: [
    { id: 'route:1', net: 'TXCP', pair: 'pair:1', nets: group, length: 4.26, skew: 0 },
    { id: 'route:2', net: 'TXP', pair: 'pair:2', nets: group, length: 5.59, skew: 0.11 },
    { id: 'route:3', net: 'TXN', length: 0.77 },
    { id: 'route:4', net: 'TXP', pair: 'pair:3', nets: group, length: 19.4, skew: 0 },
    { id: 'route:5', net: 'CLK', length: 12 },
  ],
}
/** The items a hover or pin on `net` lights, by role. */
const lit = (b, net) => {
  const roles = netRoles(b, net),
    out = { primary: [], secondary: [] }
  for (const it of b.items) {
    const r = it.net && roles.get(it.net)
    if (r) out[r].push(it.id)
  }
  return out
}

test('hovering a pair net lights every track, via and pad of it and of its partner, whether routed as a pair or not', () => {
  const { primary, secondary } = lit(board, 'TXN')
  assert.deepEqual(primary, [6, 8, 9, 10, 13, 14], 'TXN in full, the single routed stretch and its via included')
  for (const id of [4, 7, 11, 12, 15]) assert.ok(secondary.includes(id), `TXP item ${id} is the partner`)
  assert.ok(!primary.includes(16) && !secondary.includes(16), 'CLK stays out')
})

test('the far side of a series part lights with the pair', () => {
  const { primary, secondary } = lit(board, 'TXCN')
  assert.deepEqual(primary, [2, 5])
  assert.deepEqual(secondary, [1, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], 'TXCP, and TXP and TXN past the capacitors')
  const s = hoverScope({ net: 'TXP', nets: netRoles(board, 'TXP').keys() }, true, board)
  assert.ok(inScope({ net: 'TXCN' }, s), 'a pinned pair net holds the hover to its whole group')
})

test('without the nets from the export, routes sharing a net still join', () => {
  const bare = { ...board, routes: board.routes.map(({ nets, ...r }) => r) }
  assert.deepEqual(pairGroups(bare).get('TXP'), ['TXP', 'TXN'])
  assert.deepEqual(pairGroups(bare).get('TXCN'), ['TXCP', 'TXCN'])
})

test('a net of no pair lights only itself', () => {
  assert.deepEqual(lit(board, 'CLK'), { primary: [16, 17], secondary: [] })
  assert.equal(netRoles(board, null).size, 0)
})

test('the hover bubble keeps the hovered route', () => {
  assert.equal(routeHover(board, items[7]), 'TXN, 0.17 mm wide, length 5.59 mm, skew 0.11 mm')
  assert.equal(routeHover(board, items[8]), 'TXN, 0.17 mm wide, length 0.77 mm')
})
