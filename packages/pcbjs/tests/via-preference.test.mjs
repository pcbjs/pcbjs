import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import PCB, { h, route, via, nets, variants, patch, resetDefaults } from '@pcbjs/core'
import { compileBoard, compileBoards } from '@pcbjs/compile'
import { targetHash } from '@pcbjs/compile/internal/patches'
import { boardApi } from '@pcbjs/compile/query'
import { bindPCB } from '@pcbjs/fab'
import { BASE } from '@pcbjs/lib/rules'
import { twoLayer } from '@pcbjs/lib/stackups'
import { fp, handle, netOf } from './parts.mjs'

afterEach(resetDefaults)
const pref = { drill: 0.2, size: 0.45 }
const edge = () => h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 30, h: 20 })
const smd = (ref, x, y, net, layer = 'F.Cu') => fp({ ref, at: `${x} ${y}`, nets: { 1: net }, side: layer === 'B.Cu' ? 'B' : 'F' }, h('pad', { num: 1, size: 1, type: 'smd' }))
const dims = b => b.items.filter(i => i.kind === 'via').map(i => [i.drill, i.size])
const mk = (props, ...kids) => h(PCB, { name: 'Vias', via: pref, ...props }, edge(), ...kids)

test('automatic routes share dimensions across cold and warm cache; preference invalidates geometry', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pcbjs-via-'))
  try {
    const board = via => mk({ via }, smd('A', 5, 5, 'N'), smd('B', 25, 5, 'N', 'B.Cu'), route(handle('A.1'), handle('B.1')))
    const opts = { cache: { dir } }
    const cold = compileBoard(board(pref), opts)
    const warm = compileBoard(board(pref), opts)
    assert.ok(dims(cold).length > 0)
    assert.deepEqual(dims(cold), dims(warm))
    assert.deepEqual(cold.items, warm.items)
    assert.deepEqual(cold.drc, warm.drc)
    assert.ok(dims(cold).every(d => d[0] === 0.2 && d[1] === 0.45))
    const changed = compileBoard(board({ drill: 0.25, size: 0.55 }), opts)
    assert.ok(dims(changed).every(d => d[0] === 0.25 && d[1] === 0.55))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('class, route and chain overrides retain existing component-wise precedence', () => {
  const { N } = nets({ N: { class: 'power' } })
  const kids = r => [smd('A', 5, 5, N), smd('B', 25, 5, N, 'B.Cu'), r]
  const props = { autoroute: { via: { size: 0.7 } }, classes: { power: { autoroute: { via: { size: 0.65 } }, via: { drill: 0.25, size: 0.6 } } } }
  const b = compileBoard(mk(props, ...kids(route(handle('A.1'), handle('B.1')).vias({ size: 0.8 }))), { cache: false })
  assert.ok(dims(b).length)
  assert.ok(dims(b).every(d => d[0] === 0.25 && d[1] === 0.8))
  const rules = boardApi({ board: b, findings: [], snapshot: 'v' }).rulesAt([5, 5], 'F.Cu', 'N')
  assert.equal(rules.viaDrill, 0.25)
  assert.equal(rules.viaSize, 0.6)
  const chain = compileBoard(mk(props, ...kids(route(handle('A.1'), handle('B.1')).H(10).via('B.Cu', { size: 0.9 }).H(25).Z())), { cache: false })
  assert.deepEqual(dims(chain), [[0.25, 0.9]])
})

test('physical pair vias retain preferred dimensions independent of search envelope', () => {
  const two = (ref, y) =>
    fp(
      { ref, at: `10 ${y}`, nets: { 1: 'DP', 2: 'DN' } },
      h('pad', { num: 1, at: '-0.25 0', size: [0.3, 1], type: 'smd' }),
      h('pad', { num: 2, at: '0.25 0', size: [0.3, 1], type: 'smd' }),
    )
  const r = route([handle('J1.1'), handle('J1.2')], [handle('J2.1'), handle('J2.2')])
    .width(0.2)
    .gap(0.2)
    .V(8)
    .via('B.Cu')
    .V(12)
    .via('F.Cu')
    .Z()
  const b = compileBoard(mk({}, two('J1', 3), two('J2', 17), r), { cache: false })
  assert.equal(dims(b).length, 4)
  assert.ok(dims(b).every(d => d[0] === 0.2 && d[1] === 0.45))
})

test('patch defaults use board preference and preserve partial exceptions', () => {
  const kids = () => [via(netOf('N'), '5 5')]
  const plain = compileBoard(mk({}, ...kids()), { cache: false })
  const hash = targetHash(plain, [], 'net:N', 'via')
  const b = compileBoard(mk({ patches: [patch('net:N', { via: { at: '10 5', size: 0.6 } }, hash)] }, ...kids()), { cache: false })
  assert.deepEqual(dims(b), [
    [0.2, 0.45],
    [0.2, 0.6],
  ])
})

test('preset and variant preferences merge with board props', () => {
  const Fab = bindPCB({ stackup: twoLayer(), rules: BASE, via: pref })
  const b = compileBoard(h(Fab, { name: 'Preset', via: { size: 0.6 } }, edge(), via(netOf('N'), '5 5')), { cache: false })
  assert.deepEqual(dims(b), [[0.2, 0.6]])
  const V = variants(Fab, { name: 'Other', board: { via: { drill: 0.25, size: 0.55 } } })
  const boards = compileBoards(h(V, { name: 'Variants' }, edge(), via(netOf('N'), '5 5')), { cache: false })
  assert.deepEqual(boards.map(dims), [[[0.2, 0.45]], [[0.25, 0.55]]])
})

test('underlength route keeps machine short status and exposes tuning notes without implying a short circuit', async () => {
  const { inspectBoard } = await import('@pcbjs/cli/internal/inspect')
  const b = compileBoard(mk({}, smd('A', 5, 5, 'N'), smd('B', 25, 5, 'N'), route(handle('A.1'), handle('B.1')).length(200)), { cache: false })
  const q = boardApi({ board: b, findings: [], snapshot: 'length' }).route('route:1').toJSON()
  assert.equal(q.status, 'short')
  assert.ok(q.note)
  assert.equal(q.note, b.routes[0].note)
  const noted = { ...b, routes: b.routes.map(r => ({ ...r, skewNote: 'no room for skew tuning' })) }
  assert.equal(boardApi({ board: noted, findings: [], snapshot: 'notes' }).route('route:1').toJSON().skewNote, 'no room for skew tuning')
  const inspected = inspectBoard(b, 'pcb.tsx', '/', undefined, { lengths: true })
  assert.match(inspected.text.join('\n'), /below length target/)
  assert.doesNotMatch(inspected.text.join('\n'), /\bshort\b/)
})
