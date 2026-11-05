import { test } from 'node:test'
import assert from 'node:assert/strict'
import PCB, { h, route } from '@pcbjs/core'
import { previewBefore } from '../dist/pipeline.js'
import { fp, P, net } from './parts.mjs'

const src = { file: '/tmp/preview-assist.pcb.tsx', line: 20, col: 5 }
const smd = (ref, x) => fp({ ref, at: `${x} 5`, nets: { 1: 'N' } }, h('pad', { num: 1, size: 1, type: 'smd' }))

test('error preview retains current manual route points and open graph for endpoint assistance', () => {
  const a = smd('A', 5),
    b = smd('B', 25)
  const manual = route('10 5').net(net('N')).H(15)
  manual.props.__src = { ...src, line: 10 }
  const root = h(
    PCB,
    { name: 'Preview' },
    h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 30, h: 20 }),
    a,
    b,
    manual,
    route(P('A.1'), P('B.1')),
    h('circle', { layer: 'F.SilkS', cx: 20, cy: 10, r: 1, __src: src }),
  )
  const [board] = previewBefore(root, src)
  assert.equal(board.routes.length, 1, 'unfinished automatic route has no completed metadata')
  assert.equal(board.routes[0].id, 'route:1')
  assert.deepEqual(board.routes[0].pts, [
    [10, 5],
    [15, 5],
  ])
  assert.deepEqual(board.routes[0].src, { ...src, line: 10 })
  assert.ok(board.ratsnest.some(r => r.net === 'N'))
  assert.ok(board.unconnected > 0)
  assert.deepEqual(board.drc, [])
  assert.deepEqual(board.erc, [])
  assert.ok(!board.items.some(i => i.kind === 'track' && i.route === 'route:2'))
})
