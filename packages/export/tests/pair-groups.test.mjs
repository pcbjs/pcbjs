// The nets of a pair group in the site routes: a pair's two nets, and the nets past a series part where the names change.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pairGroups } from '../dist/site-data.js'

const sq = ([x, y]) => [[x - 0.3, y - 0.3], [x + 0.3, y - 0.3], [x + 0.3, y + 0.3], [x - 0.3, y + 0.3]]
let id = 0
const pad = (ref, net, at) => ({ id: ++id, kind: 'pad', ref, net, at, poly: sq(at) })
const part = (ref, pads) => ({ ref, pads: pads.map(p => p.id) })
const track = (net, role, pts) => ({ kind: 'track', net, role, pts })
/** A pair route from `a` to `b`, P then N, 0.5 mm apart in y. */
const pair = (p, n, a, b) => ({ pair: `pair:${p}`, tracks: [track(p, 'P', [a, b]), track(n, 'N', [[a[0], a[1] + 0.5], [b[0], b[1] + 0.5]])] })
const groupsOf = (pads, footprints, pairs) => pairGroups({ items: pads, footprints }, new Map(pairs.map((c, i) => [`route:${i}`, c])))

test('coupling capacitors join the pair on each side of them', () => {
  const c1 = [pad('C1', 'TXCP', [5, 0]), pad('C1', 'TXP', [6, 0])], c2 = [pad('C2', 'TXCN', [5, 0.5]), pad('C2', 'TXN', [6, 0.5])]
  const g = groupsOf([...c1, ...c2], [part('C1', c1), part('C2', c2)], [pair('TXCP', 'TXCN', [0, 0], [5, 0]), pair('TXP', 'TXN', [6, 0], [12, 0])])
  assert.deepEqual(g.get('TXN').sort(), ['TXCN', 'TXCP', 'TXN', 'TXP'])
})

test('a four-pad part joins two pairs leaving it in opposite directions, not two leaving the same way', () => {
  const l = [pad('L1', 'AP', [5, 0]), pad('L1', 'AN', [5, 0.5]), pad('L1', 'BP', [6, 0]), pad('L1', 'BN', [6, 0.5])]
  const choke = groupsOf(l, [part('L1', l)], [pair('AP', 'AN', [0, 0], [5, 0]), pair('BP', 'BN', [6, 0], [12, 0])])
  assert.deepEqual(choke.get('AP').sort(), ['AN', 'AP', 'BN', 'BP'])
  const j = [pad('J1', 'AP', [0, 0]), pad('J1', 'AN', [0, 0.5]), pad('J1', 'BP', [0, 2]), pad('J1', 'BN', [0, 2.5])]
  const plug = groupsOf(j, [part('J1', j)], [pair('AP', 'AN', [0, 0], [8, 0]), pair('BP', 'BN', [0, 2], [8, 2])])
  assert.deepEqual(plug.get('AP').sort(), ['AN', 'AP'], 'a connector with two pairs keeps them apart')
})

test('a flow-through ESD array keeps its lanes apart', () => {
  const u = [pad('U2', 'TXP', [5, 0]), pad('U2', 'TXN', [5, 0.5]), pad('U2', 'TXP', [6, 0]), pad('U2', 'TXN', [6, 0.5]),
    pad('U2', 'RXP', [5, 2]), pad('U2', 'RXN', [5, 2.5]), pad('U2', 'RXP', [6, 2]), pad('U2', 'RXN', [6, 2.5])]
  const g = groupsOf(u, [part('U2', u)], [pair('TXP', 'TXN', [0, 0], [5, 0]), pair('TXP', 'TXN', [6, 0], [12, 0]), pair('RXP', 'RXN', [0, 2], [5, 2])])
  assert.deepEqual(g.get('TXP'), ['TXP', 'TXN'])
  assert.deepEqual(g.get('RXN'), ['RXP', 'RXN'])
  assert.equal(g.get('GND'), undefined)
})
