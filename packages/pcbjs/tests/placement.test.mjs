// Auto placement: the seeded placer over the ratsnest half-perimeter, each row of the at:* precedence table, solvers and their order.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { h } from '@pcbjs/core/jsx-runtime'
import PCB, { nets, route } from '@pcbjs/core'
import { compileBoard, CompileError } from '@pcbjs/compile'
import { fp, handle } from './parts.mjs'

const edge = (w = 30, hh = 20) => h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w, h: hh })
const yard = (w, hh) => h('rect', { layer: 'F.CrtYd', x: -w / 2, y: -hh / 2, w, h: hh, width: 0.05 })
/** A two pad part 2 by 1 mm with a courtyard, on nets a and b. */
const chip = (ref, place, a, b) =>
  fp(
    { ref, ...place, nets: { 1: a, 2: b } },
    h('pad', { num: 1, at: '-0.75 0', size: [0.8, 0.9], type: 'smd' }),
    h('pad', { num: 2, at: '0.75 0', size: [0.8, 0.9], type: 'smd' }),
    yard(2.6, 1.6),
  )
const board = (props, ...kids) => h(PCB, { name: 'Place', ...props }, edge(), ...kids)
const at = (b, ref) => b.footprints.find(f => f.ref === ref)
/** The ratsnest half-perimeter of every net, as the placer measures it. */
function hpwl(b) {
  const byNet = new Map()
  for (const it of b.items) if (it.kind === 'pad' && it.net) byNet.set(it.net, [...(byNet.get(it.net) ?? []), it.at])
  let s = 0
  for (const pts of byNet.values()) {
    if (pts.length < 2) continue
    const xs = pts.map(p => p[0]),
      ys = pts.map(p => p[1])
    s += Math.max(...xs) - Math.min(...xs) + Math.max(...ys) - Math.min(...ys)
  }
  return s
}

/** Four chips between two fixed anchors, auto placed from the corners they start in, or placed there by hand. */
function fixture(seed, auto = true) {
  const N = nets()
  const corner = ['2 2 0', '28 2 0', '2 18 0', '28 18 0']
  const place = i => (auto ? { at: 'auto', 'at:initial': corner[i] } : { at: corner[i] })
  return board(
    seed === undefined ? {} : { place: { seed } },
    chip('J1', { at: '4 10' }, N.A, N.B),
    chip('J2', { at: '26 10' }, N.C, N.D),
    chip('R1', place(0), N.A, N.C),
    chip('R2', place(1), N.B, N.D),
    chip('R3', place(2), N.A, N.D),
    chip('R4', place(3), N.B, N.C),
  )
}

test('placer: deterministic for a seed, and the result is carried as placed with its at', () => {
  const a = compileBoard(fixture(7)),
    b = compileBoard(fixture(7))
  assert.deepEqual(
    a.footprints.map(f => [f.ref, f.at, f.rot]),
    b.footprints.map(f => [f.ref, f.at, f.rot]),
  )
  assert.deepEqual(
    a.placed.map(p => [p.ref, p.by]),
    [
      ['R1', 'placer'],
      ['R2', 'placer'],
      ['R3', 'placer'],
      ['R4', 'placer'],
    ],
  )
  const r1 = a.placed[0].at.split(' ').map(Number)
  assert.ok(Math.abs(r1[0] - at(a, 'R1').at[0]) < 1e-6 && Math.abs(r1[1] - at(a, 'R1').at[1]) < 1e-6)
})

test('placer: improves the half-perimeter over the initial layout, inside the outline and clear of the courtyards', () => {
  const placed = compileBoard(fixture(1)),
    start = compileBoard(fixture(1, false))
  assert.ok(hpwl(placed) < hpwl(start) * 0.8, `${hpwl(placed)} against ${hpwl(start)}`)
  assert.deepEqual(
    placed.drc.filter(d => d.rule === 'courtyard' || d.rule.startsWith('edge-')),
    [],
  )
  for (const f of placed.footprints) assert.ok(f.at[0] > 0 && f.at[0] < 30 && f.at[1] > 0 && f.at[1] < 20, `${f.ref} at ${f.at}`)
})

test('placer: a fixed slot constrains the search, "10 auto 90" keeps x and the rotation', () => {
  const N = nets()
  const b = compileBoard(board({}, chip('J1', { at: '4 15' }, N.A, N.B), chip('R1', { at: '10 auto 90' }, N.A, N.B)))
  const r = at(b, 'R1')
  assert.equal(r.at[0], 10)
  assert.equal(r.rot, 90)
  assert.ok(r.at[1] > 10, `R1 moves toward J1, y ${r.at[1]}`)
  assert.equal(b.placed[0].at, `10 ${r.at[1]} 90`)
})

test('at:cost: null forbids a pose and a number adds to the search', () => {
  const N = nets()
  const right = (layout, x) => (x < 20 ? null : 0)
  const b = compileBoard(board({}, chip('J1', { at: '4 10' }, N.A, N.B), chip('R1', { at: 'auto', 'at:initial': '25 10', 'at:cost': right }, N.A, N.B)))
  assert.ok(at(b, 'R1').at[0] >= 20, `x ${at(b, 'R1').at[0]}`)
})

test('at:solver: wins over at:cost, may call it, sees at:initial and the fixed slots, and a fixed slot wins over its pose', () => {
  const N = nets()
  const seen = []
  const solver = (layout, req) => {
    seen.push({ ...req, cost: req.cost(5, 5, 0), j1: layout.part('J1')?.x })
    return { x: 7, y: 8, r: 45 }
  }
  const b = compileBoard(
    board({}, chip('J1', { at: '4 10' }, N.A, N.B), chip('R1', { at: 'auto auto 180', 'at:initial': '1 2 180', 'at:solver': solver, 'at:cost': () => 3 }, N.A, N.B)),
  )
  assert.deepEqual(at(b, 'R1').at, [7, 8])
  assert.equal(at(b, 'R1').rot, 180)
  assert.equal(seen[0].ref, 'R1')
  assert.deepEqual(seen[0].fixed, [null, null, 180])
  assert.deepEqual(seen[0].initial, { x: 1, y: 2, r: 180 })
  assert.equal(seen[0].cost, 3)
  assert.equal(seen[0].j1, 4)
  assert.equal(b.placed[0].by, 'solver')
})

test('at:solver: null leaves the part to the placer and its at:cost', () => {
  const N = nets()
  const b = compileBoard(
    board({}, chip('J1', { at: '4 10' }, N.A, N.B), chip('R1', { at: 'auto', 'at:initial': '25 10', 'at:solver': () => null, 'at:cost': (l, x) => (x < 20 ? null : 0) }, N.A, N.B)),
  )
  assert.equal(b.placed[0].by, 'placer')
  assert.ok(at(b, 'R1').at[0] >= 20)
})

test('at:* without an auto slot, and at:follow with a fixed x, are compile errors', () => {
  const N = nets()
  assert.throws(() => compileBoard(board({}, chip('R1', { at: '5 5', 'at:cost': () => 0 }, N.A, N.B))), /: at:cost needs a slot of at left auto/)
  assert.throws(() => compileBoard(board({}, chip('R1', { at: '5 5', 'at:initial': '1 1' }, N.A, N.B))), /at:initial needs a slot of at left auto/)
  const r = route(handle('J1.1'), handle('J2.1'))
  assert.throws(
    () =>
      compileBoard(board({}, chip('J1', { at: '4 10' }, N.A, N.B), chip('J2', { at: '20 10' }, N.A, N.C), r, chip('C1', { at: '5 auto', 'at:follow': { route: r } }, N.B, N.C))),
    /at:follow places x and y beside the route/,
  )
})

test('solver-order: a solver reading a part the placer places after it', () => {
  const N = nets()
  const e = (() => {
    try {
      compileBoard(board({}, chip('R1', { at: 'auto', 'at:solver': l => (l.part('R2'), null) }, N.A, N.B), chip('R2', { at: 'auto' }, N.A, N.B)))
    } catch (err) {
      return err
    }
  })()
  assert.ok(e instanceof CompileError)
  assert.equal(e.code, 'solver-order')
  assert.match(e.message, /^a solver reads a result made after it: R1.* → R2/)
})

test('solver-order: a solver reading its own part', () => {
  const N = nets()
  assert.throws(
    () => compileBoard(board({}, chip('R1', { at: 'auto', 'at:solver': l => (l.part('R1'), null) }, N.A, N.B))),
    e => e.code === 'solver-order' && /^a solver reads its own result: R1/.test(e.message),
  )
})
