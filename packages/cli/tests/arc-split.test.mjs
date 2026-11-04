import { test } from 'node:test'
import assert from 'node:assert/strict'
import PCB, { h, nets, resetDefaults, route } from '@pcbjs/core'
import { arcPoint, splitArc } from '@pcbjs/core/internal/trace-arc'
import { compileBoard } from '@pcbjs/compile'

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`)
for (const side of ['F', 'B'])
  for (const angle of [90, -90, 270, -270]) {
    test(`split ${angle} degree arcs agree with compiler geometry in a rotated ${side} frame`, () => {
      resetDefaults()
      const { V } = nets(),
        from = [0, 0],
        to = [10, 3],
        at = arcPoint(from, to, angle, 0.35),
        split = splitArc(from, to, angle, at)
      const compile = divided => {
        const chain = divided ? route('0 0').net(V).A(at[0], at[1], split.first).A(to[0], to[1], split.second) : route('0 0').net(V).A(to[0], to[1], angle)
        return compileBoard(h(PCB, { name: 'Arc' }, h('rect', { layer: 'Edge.Cuts', x: -20, y: -20, w: 80, h: 80 }), h('g', { at: '20 30 90', side }, chain)), { cache: false })
      }
      const original = compile(false),
        divided = compile(true)
      const arcs = b => b.items.flatMap(it => (it.kind === 'track' ? (it.prims ?? []) : [])).filter(p => p.kind === 'arc')
      const one = arcs(original),
        two = arcs(divided)
      assert.equal(one.length, 1)
      assert.equal(two.length, 2)
      for (const p of two) {
        near(p.center[0], one[0].center[0])
        near(p.center[1], one[0].center[1])
        assert.equal(p.cw, one[0].cw)
      }
      near(two[0].from[0], one[0].from[0])
      near(two[0].from[1], one[0].from[1])
      near(two[1].to[0], one[0].to[0])
      near(two[1].to[1], one[0].to[1])
      assert.deepEqual(divided.routes[0].pts.at(-1), original.routes[0].pts.at(-1))
    })
  }
