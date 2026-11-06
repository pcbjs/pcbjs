// A representative generated board checks connectivity and DRC with many repeated parts and a copper pour.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import PCB, { h, pour, route } from '@pcbjs/core'
import { PinHeader } from '@pcbjs/lib/internal/headers'
import { compileBoard } from '@pcbjs/compile'
import { netOf, place } from './parts.mjs'

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
      kids.push(place(PinHeader(2), { ref: `J${++n}`, at: `${x} ${y}`, 'net:1': net, 'net:2': 'GND' }))
      kids.push(place(PinHeader(2), { ref: `J${++n}`, at: `${x + 5} ${y}`, 'net:1': net, 'net:2': 'GND' }))
      kids.push(
        route(`${x} ${y}`)
          .net(netOf(net))
          .width(0.3)
          .H(x + 5),
      )
    }
  kids.push(pour(netOf('GND'), 'B.Cu', `M0 0 H${w} V${ht} H0 Z`))
  return h(PCB, { name: 'Grid' }, ...kids)
}

test('a generated 400-item board with a pour is fully connected and DRC clean', () => {
  const b = compileBoard(gridBoard(6, 5))
  assert.ok(b.items.length >= 380, `${b.items.length} items`)
  assert.equal(b.unconnected, 0)
  assert.deepEqual(b.drc, [])
})
