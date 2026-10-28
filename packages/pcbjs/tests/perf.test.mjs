// A guard against quadratic compile passes: a generated board of about 400 items with a pour must compile quickly.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import PCB, { h, pour } from '@pcbjs/core'
import { PinHeader } from '@pcbjs/lib/headers'
import { compileBoard } from '@pcbjs/compile'

/** cols x rows pairs of 1x2 headers, pin 1 of each pair joined on F.Cu, pin 2 on GND, a GND pour on B.Cu. */
function gridBoard(cols, rows) {
  const w = cols * 10 + 2,
    ht = rows * 6 + 2
  const kids = [h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w, h: ht })]
  let n = 0
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const x = c * 10 + 2,
        y = r * 6 + 2,
        net = `S${r}_${c}`
      kids.push(h(PinHeader, { ref: `J${++n}`, pins: 2, at: `${x} ${y}`, 'net:1': net, 'net:2': 'GND' }))
      kids.push(h(PinHeader, { ref: `J${++n}`, pins: 2, at: `${x + 5} ${y}`, 'net:1': net, 'net:2': 'GND' }))
      kids.push(h('track', { net, layer: 'F.Cu', width: 0.3, d: `M${x} ${y} L${x + 5} ${y}` }))
    }
  kids.push(pour('GND', 'B.Cu', `M0 0 H${w} V${ht} H0 Z`))
  return h(PCB, { name: 'Grid' }, ...kids)
}

test('perf: a generated 400-item board with a pour compiles DRC clean well under the bound, with phase timings', () => {
  const t = performance.now()
  const b = compileBoard(gridBoard(6, 5))
  const ms = performance.now() - t
  assert.ok(b.items.length >= 380, `${b.items.length} items`)
  assert.equal(b.unconnected, 0)
  assert.deepEqual(b.drc, [])
  assert.ok(ms < 5000, `compile took ${ms | 0} ms`)
  assert.deepEqual(Object.keys(b.timings).sort(), ['connectivity', 'drc', 'erc', 'route', 'zones'])
  for (const v of Object.values(b.timings)) assert.ok(typeof v === 'number' && v >= 0)
})
