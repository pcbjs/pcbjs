// A wrong pad in a placement's thermal map is reported at the placement, the footprint's own file after it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import PCB, { h, nets } from '@pcbjs/core'
import { R0603 } from '@pcbjs/lib'
import { compileBoard, CompileError } from '@pcbjs/compile'

test('thermal map: a pad the footprint does not have is reported at the placement', () => {
  const { A, B } = nets()
  const R1 = R0603('1k').connect(A, B)
  const at = { file: 'pcb.tsx', line: 65, col: 5, endLine: 65, endCol: 40 }
  assert.throws(
    () => compileBoard(h(PCB, { name: 'T' }, h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 20, h: 20 }), h(R1, { at: '5 5', thermal: { 3: 'solid' }, __src: at }))),
    e => e instanceof CompileError && /thermal names pad "3", which the footprint does not have \(pcb\.tsx:65:5/.test(e.message) && e.src?.file === 'pcb.tsx' && e.src.line === 65,
  )
})
