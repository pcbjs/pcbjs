// References in the viewer: ?select= takes any reference and keeps the selection in the URL, a finding is focused by its exact id
// and found again by its fingerprint once a recompile renumbers it, and a hover leaves the page by item uid.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

registerHooks({
  resolve: (spec, ctx, next) => {
    try {
      return next(spec, ctx)
    } catch (error) {
      if (spec.startsWith('.') && !spec.endsWith('.ts')) return next(spec + '.ts', ctx)
      throw error
    }
  },
})
const { boxOf, displayRef, fromWire, partRef, refocus, siteTarget, targetBox, toWire } = await import('../src/refs.ts')
import { parseViewQuery, selectSearch } from '../src/query.ts'
import { shapeOf } from '@pcbjs/core/site-shapes'
import { shaped } from './shaped.mjs'
import { parseSelectParam, selectParam } from '@pcbjs/core/internal/selection'

const sq = (x, y, s = 1) => [
  [
    [x, y],
    [x + s, y],
    [x + s, y + s],
    [x, y + s],
  ],
]
const fp = (ref, x, pads) => ({ ref, at: [x, 5], bbox: { x: x - 1, y: 4, w: 2, h: 2 }, pads })
const finding = (id, fingerprint, at) => ({ id, fingerprint, at, rule: 'clearance', severity: 'error', message: '', refs: ['R101/1', 'net:GND'] })
const site = (shift = 0) =>
  shaped({
    name: 'B',
    nets: ['GND', 'VCC'],
    footprints: [fp('R101', 5, [{ num: '1', name: '1', net: 'GND', at: [4.5, 5] }]), fp('R201', 15, [{ num: '1', name: 'A', net: 'VCC', at: [14.5, 5] }]), fp('J1', 25, [])],
    items: [
      { id: 1 + shift, uid: 'item:000000000001', kind: 'pad', ref: 'R101', net: 'GND', pad: '1', layers: ['F.Cu'], rings: sq(4, 4.5) },
      { id: 2 + shift, uid: 'item:000000000002', kind: 'pad', ref: 'R201', net: 'VCC', pad: '1', layers: ['F.Cu'], rings: sq(14, 4.5) },
      { id: 3 + shift, uid: 'item:000000000003', kind: 'track', net: 'GND', layers: ['F.Cu'], rings: sq(4, 10, 6) },
      { id: 4 + shift, uid: 'item:000000000004', kind: 'track', net: 'VCC', layers: ['F.Cu'], rings: sq(14, 10, 3), route: 'route:vccTrunk' },
      { id: 5 + shift, uid: 'item:000000000005', kind: 'zone', net: 'GND', layers: ['In1.Cu'], rings: sq(0, 0, 30) },
    ],
    routes: [
      {
        id: 'route:vccTrunk',
        net: 'VCC',
        length: 3,
        pts: [
          [14, 10],
          [17, 10],
        ],
      },
    ],
    drc: [finding(shift ? 'drc:clearance:bbbbbbbbbbbb' : 'drc:clearance:aaaaaaaaaaaa', 'f00d', [5 + shift / 100, 5])],
    erc: [],
    schematic: {
      parts: [
        { ref: 'R101', path: ['CH1'], local: 'R01' },
        { ref: 'R201', path: ['CH2'], local: 'R01' },
        { ref: 'J1', path: [], local: 'J1' },
      ],
      circuits: [{ path: ['CH1'] }, { path: ['CH2'] }],
      nets: [],
    },
  })

test('siteTarget: tree names, pads by number then pin name, and the typed segments the viewer selects', () => {
  const s = site()
  assert.deepEqual(siteTarget(s, 'R201'), { kind: 'part', ref: 'R201' })
  assert.deepEqual(siteTarget(s, 'CH2/R01'), { kind: 'part', ref: 'R201' })
  assert.deepEqual(siteTarget(s, 'board:B/J1'), { kind: 'part', ref: 'J1' })
  assert.deepEqual(siteTarget(s, 'CH1'), { kind: 'group', key: 'CH1', refs: ['R101'] })
  assert.deepEqual(siteTarget(s, 'CH2/R01/A'), { kind: 'pad', ref: 'R201', num: '1', id: 2 })
  assert.deepEqual(siteTarget(s, 'net:GND'), { kind: 'net', net: 'GND' })
  assert.deepEqual(siteTarget(s, 'route:vccTrunk'), { kind: 'route', id: 'route:vccTrunk', net: 'VCC', ids: [4] })
  assert.deepEqual(siteTarget(s, 'route:vccTrunk/pt:1'), { kind: 'pt', route: 'route:vccTrunk', pt: 1, at: [17, 10], net: 'VCC' })
  assert.deepEqual(siteTarget(s, 'plane:In1.Cu:GND'), { kind: 'plane', layer: 'In1.Cu', net: 'GND', ids: [5] })
  assert.throws(() => siteTarget(s, 'route:vccTrunk/pt:5'), /pt:0 to pt:1/)
  assert.deepEqual(siteTarget(s, 'item:000000000003'), { kind: 'item', id: 3, net: 'GND' })
  assert.equal(siteTarget(s, 'drc:clearance:aaaaaaaaaaaa').marker, s.drc[0])
  assert.throws(() => siteTarget(s, 'R01'), /R01 names several: CH1\/R01, CH2\/R01/)
  assert.throws(() => siteTarget(s, 'R1.2'), /no part, group or instance named R1\.2/)
  assert.throws(() => siteTarget(s, 'board:Other/R101'), /names board Other/)
  assert.throws(() => siteTarget(s, 'drc:clearance:cccccccccccc'), /no finding/)
  assert.equal(partRef(s, 'R201'), 'CH2/R01')
  assert.equal(partRef(s, 'J1'), 'J1')
})

test('?select=: a reference round-trips through the URL and names the same thing again', () => {
  const s = site()
  for (const ref of ['CH2/R01', 'CH1', 'net:GND', 'R101/1', 'drc:clearance:aaaaaaaaaaaa', 'net:P1/CC1']) {
    const search = selectSearch('?view=2d&side=B', ref)
    const q = parseViewQuery(search)
    assert.equal(q.select, ref)
    assert.equal(q.view, '2d')
    if (ref !== 'net:P1/CC1') assert.deepEqual(siteTarget(s, q.select), siteTarget(s, ref))
  }
  assert.equal(selectSearch('?select=R1&view=3d', null), '?view=3d')
})

test('?select= lists the members anchor first and ?isolate= names the isolated group; both come back as they went', () => {
  const sel = { refs: ['CH1', 'net:GND', 'CH2/R01/A'], anchor: 'net:GND' }
  const text = selectParam(sel)
  assert.equal(text, 'net:GND,CH1,CH2/R01/A')
  const search = selectSearch('?view=3d', text, 'CH2')
  assert.equal(search, '?view=3d&select=net:GND,CH1,CH2/R01/A&isolate=CH2', 'commas, slashes and colons stay readable')
  const q = parseViewQuery(search)
  assert.equal(q.isolate, 'CH2')
  const back = parseSelectParam(q.select)
  assert.equal(back.anchor, 'net:GND')
  assert.deepEqual(new Set(back.refs), new Set(sel.refs))
  assert.equal(back.refs.at(-1), 'net:GND', 'the anchor is the member joined last')
  assert.equal(selectParam({ refs: [], anchor: null }), null)
  assert.equal(selectSearch(search, null, null), '?view=3d')
})

test('a finding focused by its exact id is found again by its fingerprint after a recompile renumbers it', () => {
  const before = site(),
    after = site(10)
  const f = before.drc[0]
  const held = { id: f.id, fingerprint: f.fingerprint, at: f.at }
  assert.equal(refocus(held, before.drc), f)
  assert.equal(refocus(held, after.drc), after.drc[0])
  assert.equal(refocus(held, [{ ...after.drc[0], fingerprint: 'other' }]), null)
})

test('targetBox: a net frames its copper, a finding its position with a margin', () => {
  const s = site()
  const net = targetBox(s, siteTarget(s, 'net:GND'))
  const copper = boxOf(s.items.filter(i => i.net === 'GND' && i.kind !== 'zone').flatMap(i => shapeOf(s, i.id)))
  assert.ok(net[0] < copper[0] && net[1] < copper[1] && net[2] > copper[2] && net[3] > copper[3])
  const at = targetBox(s, siteTarget(s, 'drc:clearance:aaaaaaaaaaaa'))
  assert.deepEqual(at, [3, 3, 4, 4])
})

test('a hover leaves the page by item uid and comes back as this snapshot ids', () => {
  const a = site(),
    b = site(10)
  const wire = toWire(a, { ids: [1, 3], refs: ['R101'], net: 'GND' })
  assert.deepEqual(wire, { uids: ['item:000000000001', 'item:000000000003'], refs: ['R101'], net: 'GND' })
  assert.deepEqual(fromWire(b, wire), { ids: [11, 13], refs: ['R101'], net: 'GND' })
  assert.equal(fromWire(b, { uids: ['item:0000000000ff'], refs: [], net: null }), null)
})

test('a group frame includes the whole compass about its actual grid pivot, even outside its parts', () => {
  const s = site()
  s.edit = [{ ref: 'CH1', caps: ['placed'], at: [0, 0, 0], pivot: [-5, 8] }]
  const b = targetBox(s, siteTarget(s, 'CH1'))
  const r = Math.hypot(6 - -5, 4 - 8)
  assert.ok(b[0] < -5 - r && b[0] + b[2] > -5 + r)
  assert.ok(b[1] < 8 - r && b[1] + b[3] > 8 + r)
})

test('library labels are local while part and pad targets retain source identities', async () => {
  const s = site()
  s.footprints[0].displayRef = 'R0'
  s.schematic.circuits[0].layout = 'lib/channel.tsx#Row'
  assert.equal(displayRef(s, 'R101'), 'R0')
  assert.equal(displayRef(s, 'CH1/R01'), 'R0')
  assert.equal(displayRef(s, 'CH1/R01/1'), 'R0/1')
  assert.equal(displayRef(s, 'CH1'), 'Row')
  assert.equal(displayRef(s, 'route:vccTrunk'), 'route:vccTrunk')
  assert.deepEqual(siteTarget(s, 'CH1/R01'), { kind: 'part', ref: 'R101' })
  const { chipPath } = await import('../src/selection.ts')
  assert.deepEqual(chipPath(s, 'R101'), [{ ref: 'R101', label: 'R0' }])
  assert.equal(displayRef(site(), 'CH1/R01'), 'CH1/R01')
})

test('library display references include unplaced schematic parts', async () => {
  const s = site()
  s.footprints = []
  s.schematic.parts = [{ ref: 'R901', local: 'A', path: ['CH9'], prefix: 'R', displayRef: 'R0', pins: [], placed: false }]
  assert.equal(displayRef(s, 'R901'), 'R0')
  assert.equal(displayRef(s, 'CH9/A'), 'R0')
  const { chipPath, click, emptySelection } = await import('../src/selection.ts')
  assert.deepEqual(chipPath(s, 'CH9/A'), [{ ref: 'CH9/A', label: 'R0' }])
  const selection = click(emptySelection('B'), s, { kind: 'body', ref: 'R901' }, { deep: true, shift: false })
  assert.equal(selection.anchor, 'CH9/A')
})
