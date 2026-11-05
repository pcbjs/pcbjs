// The text of the tools' edits: a placement's `at` in mm, grid units or explicit mm, units kept, the side inserted and removed, a chain
// call's arguments with the relative call after it compensated, an automatic waypoint and a call deleted.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addChild,
  chainCallAt,
  chainEndOf,
  deleteCall,
  diffEdit,
  elementAt,
  insertWaypoint,
  movePoint,
  routeLayer,
  setAt,
  setSide,
  setLocked,
  lockReason,
  setGrid,
  textDoc,
  writeAt,
} from '../dist/edits.js'
import { docOf, parse } from '../dist/doc.js'

const offsetOf = (text, line, col) => textDoc(text).span({ line, col }).start

const apply = (text, edits) => [...edits].sort((a, b) => b.start - a.start).reduce((t, e) => t.slice(0, e.start) + e.newText + t.slice(e.end), text)

test('placement locks add and remove only a bare attribute, preserving neighboring syntax', () => {
  for (const text of ['<R1 at="1 2" />', '<R1\n  at={position}\n/>', '<R1><ref at="0 1" /></R1>']) {
    const el = elementAt(parse(text, 'pcb.tsx'), 0)
    const locked = apply(text, [setLocked(text, el, true)])
    const next = elementAt(parse(locked, 'pcb.tsx'), 0)
    assert.equal(lockReason(next), null)
    assert.equal(setLocked(locked, next, true), null)
    assert.equal(apply(locked, [setLocked(locked, next, false)]), text)
    assert.equal(setLocked(text, el, false), null)
  }
  for (const value of ['true', 'false', 'isFixed', 'config.locked', 'isFixed ? true : false']) {
    const text = `<R1 locked={${value}} />`,
      el = elementAt(parse(text, 'pcb.tsx'), 0)
    assert.match(lockReason(el), /derived from an expression and cannot be overridden/)
    for (const next of [true, false]) assert.throws(() => setLocked(text, el, next), /expression/)
  }
  for (const text of ['<R1 {...props} />', '<R1 locked {...props} />', '<R1 {...props} locked />']) {
    const el = elementAt(parse(text, 'pcb.tsx'), 0)
    assert.throws(() => setLocked(text, el, false), /props spread/)
  }
})

test('trace layer edits use the initial route property or nearest preceding via stage', () => {
  const initial = "route(a,b).H(9).layer('F.Cu').via('In1.Cu').V(12).via('B.Cu').L(20,20)"
  const edit = (needle, layer) => apply(initial, [routeLayer(parse(initial, 'pcb.tsx'), initial.indexOf(needle), layer)])
  assert.equal(edit('H(9)', 'B.Cu'), initial.replace("layer('F.Cu')", 'layer("B.Cu")'))
  assert.equal(edit('V(12)', 'In2.Cu'), initial.replace("via('In1.Cu')", 'via("In2.Cu")'))
  assert.equal(edit('L(20', 'F.Cu'), initial.replace("via('B.Cu')", 'via("F.Cu")'))
  const plain = 'route(a,b).H(9)'
  assert.equal(apply(plain, [routeLayer(parse(plain, 'pcb.tsx'), plain.indexOf('H(9)'), 'B.Cu')]), 'route(a,b).layer("B.Cu").H(9)')
})

test('primitive dot comes from syntax tokens across comments and line breaks', () => {
  const text = 'route(a,b). /* v1.2 */\n H(3).l(2,4)'
  const call = chainCallAt(parse(text, 'pcb.tsx'), text.indexOf('H(3)'))
  assert.equal(call.dot, text.indexOf('. /*'))
  assert.equal(apply(text, [deleteCall(call)]), 'route(a,b).l(2,4)')
  assert.equal(apply(text, [insertWaypoint(call.dot, [1, 2])]), "route(a,b).X('1 2'). /* v1.2 */\n H(3).l(2,4)")
})

test('writeAt: bare mm without a grid, grid units under one, explicit mm when free there, a unit kept, a zero rotation left out', () => {
  assert.equal(writeAt(7.0004, 10, 0, '5 10', { pitch: null, free: false }), '7 10')
  assert.equal(writeAt(7.62, 11.43, 0, '1 2', { pitch: 2.54, free: false }), '3 4.5')
  assert.equal(writeAt(7.623, 10.16, 0, '1 2', { pitch: 2.54, free: true }), '7.623mm 10.16mm')
  assert.equal(writeAt(2.54, 5.08, 90, '50mil 2', { pitch: 2.54, free: false }), '100mil 2 90')
  assert.equal(writeAt(1, 1, 270, '0 0 1.5708rad', { pitch: null, free: false }), '1 1 -1.5708rad')
  assert.equal(writeAt(1, 1, 360, '0 0 90', { pitch: null, free: false }), '1 1 0')
  assert.equal(writeAt(1, 1, 45, 'auto 0', { pitch: null, free: false }), 'auto 1 45')
})

test('elementAt, setAt, setSide and addChild: the literal replaced, an absent at or side inserted, side F deleted, a computed at made a literal, a child added', () => {
  const text = 'const x = 1\nexport default <PCB name="A">\n  <R1 at="5 10" side="B" />\n  <R2 />\n  <R3 at={`${x} 2`} />\n</PCB>\n'
  const r1 = elementAt(parse(text, 'pcb.tsx'), offsetOf(text, 3, 3))
  assert.equal(r1.tag, 'R1')
  assert.equal(apply(text, [setAt(r1, '7 10'), setSide(text, r1, 'F')]).split('\n')[2], '  <R1 at="7 10" />')
  const r2 = elementAt(parse(text, 'pcb.tsx'), offsetOf(text, 4, 3))
  assert.equal(apply(text, [setAt(r2, '1 1')]).split('\n')[3], '  <R2 at="1 1" />')
  assert.equal(apply(text, [setSide(text, r2, 'B')]).split('\n')[3], '  <R2 side="B" />')
  assert.equal(setSide(text, r2, 'F'), null)
  const r3 = elementAt(parse(text, 'pcb.tsx'), offsetOf(text, 5, 3))
  assert.equal(apply(text, [setAt(r3, '1 1')]).split('\n')[4], '  <R3 at="1 1" />')
  assert.equal(elementAt(parse(text, 'pcb.tsx'), offsetOf(text, 3, 4)), null)
  const row = 'export default (\n  <PCB>\n    <Row g={CH1} at="0 5" />\n  </PCB>\n)\n'
  const el = elementAt(parse(row, 'pcb.tsx'), offsetOf(row, 3, 5))
  assert.equal(el.attrs.g.expr, 'CH1')
  const once = apply(row, [addChild(row, el, offsetOf(row, 3, 5), '<CH1.R at="13 0" />')])
  assert.equal(once, 'export default (\n  <PCB>\n    <Row g={CH1} at="0 5">\n      <CH1.R at="13 0" />\n    </Row>\n  </PCB>\n)\n')
  const open = elementAt(parse(once, 'pcb.tsx'), offsetOf(once, 3, 5))
  assert.equal(
    apply(once, [addChild(once, open, offsetOf(once, 3, 5), '<CH1.D at="20 1" />')])
      .split('\n')
      .slice(2, 6)
      .join('\n'),
    '    <Row g={CH1} at="0 5">\n      <CH1.R at="13 0" />\n      <CH1.D at="20 1" />\n    </Row>',
  )
})

test('movePoint: absolute and relative calls rewritten in their own form, the relative call after compensated, a waypoint string kept quoted', () => {
  const text = "route(a, b).V(14).h('2mm').L('5 16').X()\n"
  const at = s => text.indexOf(s)
  const v = chainCallAt(parse(text, 'pcb.ts'), at('V('))
  const h = chainCallAt(parse(text, 'pcb.ts'), at('h('))
  assert.equal(v.method, 'V')
  assert.equal(apply(text, movePoint(v, [5, 10], [5, 15], { call: h, end: [7, 14] })), "route(a, b).V(15).l(2, -1).L('5 16').X()\n")
  assert.equal(apply(text, movePoint(h, [5, 14], [8.5, 14])), "route(a, b).V(14).h('3.5mm').L('5 16').X()\n")
  const l = chainCallAt(parse(text, 'pcb.ts'), at('L('))
  assert.equal(apply(text, movePoint(l, [7, 14], [6, 17])), "route(a, b).V(14).h('2mm').L('6 17').X()\n")
  const x = chainCallAt(parse(text, 'pcb.ts'), at('X('))
  assert.equal(apply(text, [insertWaypoint(x.dot, [9, 9.5])]), "route(a, b).V(14).h('2mm').L('5 16').X('9 9.5').X()\n")
  assert.equal(apply(text, [deleteCall(h)]), "route(a, b).V(14).L('5 16').X()\n")
  assert.equal(chainEndOf(parse(text, 'pcb.ts'), 0), text.indexOf('\n'))
})

test('diffEdit: the one span that differs', () => {
  assert.deepEqual(diffEdit('abc xyz', 'abc 12 xyz'), { start: 4, end: 4, newText: '12 ' })
  assert.deepEqual(diffEdit('', 'new'), { start: 0, end: 0, newText: 'new' })
})

test('placement grid writes preserve named grids, limits and coordinates, without nesting on repeated edits', () => {
  const edit = (text, pitch) => apply(text, [setGrid(elementAt(parse(text, 'pcb.tsx'), 0), pitch)])
  assert.equal(edit('<R1 at="1.23 4.56" />', 0.25), '<R1 at="1.23 4.56" grid={{ snap: 0.25 }} />')
  const named = edit('<g at="10 20" grid={G} />', 0.5)
  assert.equal(named, '<g at="10 20" grid={{ ...(G), snap: 0.5 }} />')
  assert.equal(edit(named, 0.25), named.replace('snap: 0.5', 'snap: 0.25'))
  const limited = '<R1 grid={{ maxLevel: 0, snap: 0.5 }} at="2 3" />'
  assert.equal(edit(limited, 1), limited.replace('snap: 0.5', 'snap: 1'))
  const spread = '<R1 grid={{ snap: 1, ...options }} />'
  assert.equal(edit(spread, 0.25), '<R1 grid={{ ...({ snap: 1, ...options }), snap: 0.25 }} />')
})

test('grid writes refuse overriding an unknown props spread, but accept a final explicit grid', () => {
  for (const text of ['<R1 {...props} />', '<g grid={G} {...props} />']) assert.equal(setGrid(elementAt(parse(text, 'pcb.tsx'), 0), 0.5), null)
  const text = '<g {...props} grid={G} />'
  assert.equal(apply(text, [setGrid(elementAt(parse(text, 'pcb.tsx'), 0), 0.5)]), '<g {...props} grid={{ ...(G), snap: 0.5 }} />')
})
