import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import PCB, { h, via, route, stitch, pour, defineDefaultBoard, resetDefaults } from '@pcbjs/core'
import { resolveVia, BASE } from '@pcbjs/core/internal/rules'
import { compileBoard } from '../dist/index.js'
import { boardApi } from '../dist/query/board.js'
import { net } from './parts.mjs'

afterEach(resetDefaults)
const edge = () => h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 30, h: 20 })
const mk = (props, ...kids) => compileBoard(h(PCB, { name: 'Via', ...props }, edge(), ...kids), { cache: false })
const dims = b => b.items.filter(i => i.kind === 'via').map(i => [i.drill, i.size])
const preference = { drill: 0.2, size: 0.45 }

test('via resolver grows only fallback, applies partial overrides independently', () => {
  assert.deepEqual(resolveVia({ ...BASE, minAnnularRing: 0.25 }), { drill: 0.3, size: 0.8 })
  assert.deepEqual(resolveVia(BASE, preference, { size: 0.6 }), { drill: 0.2, size: 0.6 })
  assert.deepEqual(resolveVia(BASE, { drill: 0.9 }), { drill: 0.9, size: 0.6 })
})

test('board preference merges defaults and props; standalone and chain keep exceptions', () => {
  defineDefaultBoard({ via: { drill: '0.2mm', size: 0.5 } })
  const b = mk(
    { via: { size: 0.45 } },
    via(net('A'), '5 5'),
    via(net('B'), '10 5', { size: 0.6 }),
    route('15 5').net(net('C')).via('B.Cu').H(20).via('F.Cu', { drill: 0.25, size: 0.7 }),
  )
  assert.deepEqual(b.via, preference)
  assert.deepEqual(dims(b), [
    [0.2, 0.45],
    [0.2, 0.6],
    [0.2, 0.45],
    [0.25, 0.7],
  ])
  const q = boardApi({ board: b, findings: [], snapshot: 'via' }).rulesAt([5, 5], 'F.Cu')
  assert.equal(q.viaDrill, 0.2)
  assert.equal(q.viaSize, 0.45)
  assert.equal(q.minViaDrill, b.rules.minViaDrill)
})

test('explicit invalid annular ring is emitted unchanged for DRC', () => {
  const b = mk({ via: { drill: 0.5, size: 0.55 } }, via(net('A'), '5 5'))
  assert.deepEqual(dims(b), [[0.5, 0.55]])
  assert.ok(b.drc.some(d => d.rule === 'annular-ring'))
})

test('stitching inherits the same preference and supports a partial exception', () => {
  const box = 'M0 0 H30 V20 H0 Z'
  const b = mk(
    { via: preference },
    pour(net('GND'), 'F.Cu', box, { islands: 'keep' }),
    pour(net('GND'), 'B.Cu', box, { islands: 'keep' }),
    stitch(net('GND'), { pitch: 4, via: { size: 0.6 } }),
  )
  assert.ok(dims(b).length > 10)
  assert.ok(dims(b).every(d => d[0] === 0.2 && d[1] === 0.6))
})

test('board autoroute remains a route-only override above the preference', () => {
  const b = mk({ via: preference, autoroute: { via: { size: 0.7 } } }, via(net('A'), '5 5'), route('10 5').net(net('B')).via('B.Cu'))
  assert.deepEqual(dims(b), [
    [0.2, 0.45],
    [0.2, 0.7],
  ])
  const legacy = mk({}, via(net('A'), '5 5'))
  assert.deepEqual(dims(legacy), [[0.3, 0.6]])
  assert.equal(boardApi({ board: legacy, findings: [], snapshot: 'legacy' }).rulesAt([5, 5], 'F.Cu').viaSize, 0.6)
})

test('board preference rejects malformed dimensions before geometry', () => {
  for (const via of [{ drill: 0 }, { size: Infinity }, { diameter: 0.5 }, []]) assert.throws(() => mk({ via }))
})
