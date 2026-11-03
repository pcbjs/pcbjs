// The reference grammar: every segment kind round trips, bad references name what is wrong, and a board resolves paths, pads and typed segments.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { boardIndex, isTreeRef, itemRef, itemRev, parseRef, printRef, RefError, refNet, refRoute, resolveRef, siteIndex } from '@pcbjs/core/ref'

const GOOD = [
  'R1',
  'R1/2',
  'U1/PA9',
  'CH2/R01',
  'Power/CH2/R01/2',
  'R201',
  'board:Blinky',
  'board:Blinky/R1/2',
  'net:VCC',
  'net:P1/CC1',
  'net:GND/span:F.Cu..In1.Cu',
  'route:3',
  'route:vccTrunk',
  'route:3/leg:2',
  'route:3/pt:0',
  'route:vccTrunk/pt:2',
  'pair:1',
  'drc:clearance:0123456789ab',
  'erc:single-pin-net:0123456789ab',
  'drc:si.return-path:0123456789ab',
  'item:0123456789ab',
  'item:0123456789ab~2',
  'span:F.Cu..In2.Cu',
  'plane:In1.Cu:GND',
  'plane:In1.Cu:GND/region:0123456789ab',
  'panel:Main/B3/U1',
  'board:Quad/net:3V3',
]

test('ref: every kind parses and prints back to itself', () => {
  for (const s of GOOD) assert.equal(printRef(parseRef(s)), s, s)
  assert.deepEqual(parseRef('route:3/leg:2'), [
    { kind: 'route', value: '3' },
    { kind: 'leg', value: '2' },
  ])
  assert.deepEqual(parseRef('net:P1/CC1'), [{ kind: 'net', value: 'P1/CC1' }])
  assert.deepEqual(
    parseRef('Power/CH2/R01/2'),
    ['Power', 'CH2', 'R01', '2'].map(value => ({ kind: null, value })),
  )
})

test('ref: a malformed reference throws a RefError saying why', () => {
  const bad = {
    '': /not empty/,
    'R1//2': /empty segment/,
    'R1 2': /no name/,
    'leg:2': /sits under route/,
    'route:3/leg:0': /not a leg reference/,
    'route:3/leg:1/pt:2': /takes leg: or pt: under it/,
    'R1/net:VCC': /tree path holds no typed segment/,
    'net:VCC/board:X': /board: comes first/,
    'item:xyz': /not a item reference/,
    'item:0123456789ab~1': /not a item reference/,
    'drc:clearance': /not a drc reference/,
    'span:F.Cu': /names no layer pair/,
    'panel:Main': /takes a tree path/,
    'pair:1/leg:1': /takes nothing under it/,
    'U1.3/x y': /no name/,
  }
  for (const [s, why] of Object.entries(bad))
    assert.throws(
      () => parseRef(s),
      e => e instanceof RefError && why.test(e.message),
      s,
    )
})

const pad = (id, ref, num, name, net) => ({ kind: 'pad', id, uid: `item:${String(id).padStart(12, '0')}`, ref, num, name, net, layer: 'F.Cu', at: [id, 0], layers: ['F.Cu'] })
const fp = (ref, pads) => ({ ref, value: '', id: 'R_0603', at: [0, 0], rot: 0, side: 'F', fields: {}, bom: true, pos: true, pads })
const part = (ref, path, local) => ({ ref, value: '', footprint: '', prefix: 'R', pins: [], placed: true, path, local })

function board() {
  const items = [
    pad(1, 'R1', '1', 'A', 'VCC'),
    pad(2, 'R1', '2', 'B', 'GND'),
    pad(3, 'R101', '1', 'A', 'VCC'),
    pad(4, 'R201', '1', 'A', 'VCC'),
    pad(5, 'U1', '9', 'PA9', 'TX'),
    {
      kind: 'track',
      id: 6,
      uid: 'item:aaaaaaaaaaaa',
      layer: 'F.Cu',
      net: 'VCC',
      pts: [
        [0, 0],
        [1, 0],
      ],
      width: 0.2,
      route: 'route:vccTrunk',
    },
    {
      kind: 'track',
      id: 7,
      uid: 'item:bbbbbbbbbbbb',
      layer: 'F.Cu',
      net: 'GND',
      pts: [
        [0, 1],
        [1, 1],
      ],
      width: 0.2,
      route: 'route:2',
    },
    { kind: 'via', id: 8, uid: 'item:cccccccccccc', layer: 'F.Cu', net: 'GND', at: [1, 1], drill: 0.3, size: 0.6, layers: ['F.Cu', 'B.Cu'] },
    {
      kind: 'zone',
      id: 9,
      uid: 'item:dddddddddddd',
      layer: 'B.Cu',
      net: 'GND',
      outline: [],
      priority: 0,
      fill: [
        {
          outer: [
            [0, 0],
            [5, 0],
            [5, 5],
          ],
          holes: [],
        },
      ],
    },
  ]
  return {
    name: 'Demo',
    items,
    nets: ['GND', 'TX', 'VCC', 'P1/CC1'].map((name, i) => ({ id: i + 1, name })),
    footprints: [fp('R1', [1, 2]), fp('R101', [3]), fp('R201', [4]), fp('U1', [5])],
    schematic: {
      parts: [part('R1', ['Power'], 'R1'), part('R101', ['CH1'], 'R01'), part('R201', ['CH2'], 'R01'), part('U1', [], 'U1')],
      nets: [],
      circuits: [
        { path: ['CH1'], name: 'CH1', kind: 'circuit', def: 'ch.ts#channel', circuit: 'channel', parts: ['R101'], children: [], placed: true },
        { path: ['CH2'], name: 'CH2', kind: 'circuit', def: 'ch.ts#channel', circuit: 'channel', parts: ['R201'], children: [], placed: true },
        { path: ['Power'], name: 'Power', kind: 'group', def: 'pcb.tsx#9:5', parts: ['R1'], children: [], placed: true },
      ],
    },
    routes: [
      {
        id: 'route:vccTrunk',
        net: 'VCC',
        pts: [
          [0, 0],
          [1, 0],
          [2, 0],
        ],
        legs: [{ from: [1, 0], to: [2, 0] }],
      },
      { id: 'route:2', net: 'GND' },
    ],
    pairs: [{ id: 'pair:1', nets: ['DP', 'DN'] }],
    drc: [{ id: 'drc:short:0123456789ab', rule: 'short', severity: 'error', message: '', at: [0, 0] }],
    erc: [],
  }
}

test('ref: a bare name is a part ref first, then a group or instance, then a local name in an instance', () => {
  const b = board()
  assert.deepEqual(pick(resolveRef(boardIndex(b), 'R1')), { kind: 'part', ref: 'R1', path: 'Power/R1' })
  assert.deepEqual(pick(resolveRef(boardIndex(b), 'R201')), { kind: 'part', ref: 'R201', path: 'CH2/R01' })
  assert.deepEqual(pick(resolveRef(boardIndex(b), 'CH2')), { kind: 'group', path: 'CH2', parts: ['R201'] })
  assert.deepEqual(pick(resolveRef(boardIndex(b), 'CH2/R01')), { kind: 'part', ref: 'R201', path: 'CH2/R01' })
  assert.deepEqual(pick(resolveRef(boardIndex(b), 'Power/R1')), { kind: 'part', ref: 'R1', path: 'Power/R1' })
  assert.throws(() => resolveRef(boardIndex(b), 'R01'), /R01 names several: CH1\/R01, CH2\/R01/)
  assert.throws(() => resolveRef(boardIndex(b), 'R9'), /no part, group or instance named R9/)
})

test('ref: a pad by number then pin name, under a ref or an instance path', () => {
  const b = board()
  assert.equal(resolveRef(boardIndex(b), 'R1/2').pad.id, 2)
  assert.equal(resolveRef(boardIndex(b), 'R1/B').pad.id, 2)
  assert.equal(resolveRef(boardIndex(b), 'U1/PA9').pad.id, 5)
  assert.equal(resolveRef(boardIndex(b), 'CH2/R01/1').pad.id, 4)
  assert.equal(resolveRef(boardIndex(b), 'board:Demo/U1/9').pad.id, 5)
  assert.throws(() => resolveRef(boardIndex(b), 'R1/7'), /R1 has no pad 7; pads 1 A, 2 B/)
  assert.throws(() => resolveRef(boardIndex(b), 'board:Other/R1'), /names board Other, this is Demo/)
})

test('ref: typed segments resolve to nets, routes, legs, points, pairs, items, findings, spans and planes', () => {
  const b = board()
  assert.equal(resolveRef(boardIndex(b), 'net:VCC').net.name, 'VCC')
  assert.equal(resolveRef(boardIndex(b), 'net:P1/CC1').net.name, 'P1/CC1')
  assert.equal(resolveRef(boardIndex(b), 'route:vccTrunk').route.net, 'VCC')
  assert.throws(() => resolveRef(boardIndex(b), 'route:1'), /no route:1, or it is bound/)
  assert.deepEqual(resolveRef(boardIndex(b), 'route:vccTrunk/pt:2').at, [2, 0])
  assert.deepEqual(resolveRef(boardIndex(b), 'route:vccTrunk/leg:1').from, [1, 0])
  assert.throws(() => resolveRef(boardIndex(b), 'route:vccTrunk/leg:2'), /has 1 automatic leg$/)
  assert.equal(resolveRef(boardIndex(b), 'pair:1').pair.nets[0], 'DP')
  assert.equal(resolveRef(boardIndex(b), 'item:cccccccccccc').item.id, 8)
  assert.equal(resolveRef(boardIndex(b), 'drc:short:0123456789ab').finding.rule, 'short')
  assert.deepEqual(
    resolveRef(boardIndex(b), 'net:GND/span:F.Cu..B.Cu').vias.map(v => v.id),
    [8],
  )
  assert.equal(resolveRef(boardIndex(b), 'span:B.Cu..F.Cu').vias.length, 1)
  assert.equal(resolveRef(boardIndex(b), 'plane:B.Cu:GND').zones[0].id, 9)
  assert.throws(() => resolveRef(boardIndex(b), 'plane:F.Cu:GND'), /no pour of GND on F.Cu/)
  assert.throws(() => resolveRef(boardIndex(b), 'panel:Main/B3/U1'), /no panel/)
})

test('ref: an item as findings name it', () => {
  const b = board()
  assert.equal(itemRef(b.items[1]), 'R1/2')
  assert.equal(itemRef(b.items[5]), 'route:vccTrunk')
  assert.equal(itemRef(b.items[6]), 'net:GND')
  assert.equal(itemRef({ kind: 'via', uid: 'item:eeeeeeeeeeee', layer: 'F.Cu', at: [0, 0], layers: ['F.Cu', 'B.Cu'] }), 'item:eeeeeeeeeeee')
})

function pick(r) {
  const { footprint: _f, ...rest } = r
  return rest
}

/** The board as its joined facets carry it: footprints with pad rows, item rows, routes with their chain steps. */
function siteOf(b) {
  const byId = new Map(b.items.map(it => [it.id, it]))
  return {
    name: b.name,
    nets: b.nets.map(n => n.name),
    footprints: b.footprints.map(f => ({ ref: f.ref, pads: f.pads.map(id => ({ num: byId.get(id).num, name: byId.get(id).name, uid: byId.get(id).uid })) })),
    schematic: b.schematic,
    drc: b.drc,
    erc: b.erc,
    items: b.items.map(it => ({ id: it.id, uid: it.uid, kind: it.kind, layers: it.layers ?? [it.layer], net: it.net, route: it.route })),
    routes: [{ id: 'route:vccTrunk', net: 'VCC', pts: b.routes[0].pts }],
    edit: [{ ref: 'route:vccTrunk', steps: [{ op: 'H' }, { op: 'X' }] }],
  }
}

test('ref: the joined facets resolve every reference as the board does, through one resolver', () => {
  const b = board()
  const on = (ix, text) => {
    const r = resolveRef(ix, text)
    const key = r.pad?.uid ?? r.item?.uid ?? r.route?.id ?? r.finding?.id ?? r.ref ?? r.path ?? r.net?.name ?? r.net ?? r.layer
    return [r.kind, key, r.from ?? r.at ?? null]
  }
  const s = siteIndex(siteOf(b))
  for (const text of [
    'R1',
    'CH2/R01',
    'CH2',
    'R1/B',
    'U1/PA9',
    'net:VCC',
    'route:vccTrunk',
    'route:vccTrunk/pt:2',
    'route:vccTrunk/leg:1',
    'item:cccccccccccc',
    'drc:short:0123456789ab',
    'plane:B.Cu:GND',
  ])
    assert.deepEqual(on(s, text), on(boardIndex(b), text), text)
  assert.equal(resolveRef(s, 'route:2').route.net, 'GND', 'a route the site lists only on its copper')
  assert.equal(resolveRef(s, 'net:GND/span:F.Cu..B.Cu').vias[0].uid, 'item:cccccccccccc')
  assert.throws(() => resolveRef(s, 'R01'), /names several: CH1\/R01, CH2\/R01/)
})

test('ref: the net, route and tree form of a reference, read by the grammar', () => {
  assert.equal(refNet('net:P1/CC1'), 'P1/CC1')
  assert.equal(refNet('R1/2'), null)
  assert.equal(refNet('net:VCC/span:F.Cu..B.Cu'), null)
  assert.equal(refRoute('route:3/leg:2'), 'route:3')
  assert.equal(refRoute('board:Demo/CH2/route:vccTrunk/pt:1'), 'CH2/route:vccTrunk')
  assert.equal(refRoute('net:VCC'), null)
  assert.equal(isTreeRef('CH2/R01/1'), true)
  assert.equal(isTreeRef('item:0123456789ab'), false)
  assert.equal(isTreeRef('not a ref'), false)
})

test('ref: an item rev follows its content, never its uid', () => {
  const b = board()
  const t = b.items.find(it => it.kind === 'track')
  assert.match(itemRev(t), /^[0-9a-f]{12}$/)
  assert.equal(itemRev({ ...t, uid: 'item:000000000000' }), itemRev(t))
  assert.notEqual(itemRev({ ...t, pts: [[0, 2], t.pts[1]] }), itemRev(t))
  const z = b.items.find(it => it.kind === 'zone')
  assert.equal(itemRev({ ...z, fill: [] }), itemRev(z), 'a pour by its declared outline, never its fill')
})
