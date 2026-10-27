// inspect --layer lists every item drawn on one layer with its ink bounds, text and source; a net's pours print per layer
// with their fill area, pieces and removed islands; inspectRequests turns --layer into requests.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import PCB, { h, stitch } from '@pcbjs/core'
import { compileBoard } from '@pcbjs/compile'
import { inspectBoard } from '../dist/inspect.js'
import { inspectRequests } from '../dist/cli.js'

const pad = (ref, x, y, net) => h('footprint', { ref, value: 'V', id: 'pcbjs:TestPad', at: `${x}mm ${y}mm`, 'net:pad1': net, bom: false },
  h('pad', { num: 1, size: 1, shape: 'circle', drill: 0.5 }),
  h('path', { layer: 'F.SilkS', d: 'M -1 -1.5 A 1.5 1.5 0 0 1 1 -1.5', width: 0.2 }))
const board = () => compileBoard(h(PCB, { name: 'Layers' },
  h('path', { layer: 'Edge.Cuts', d: 'M 0 0 H 30 V 20 H 0 Z' }),
  pad('TP1', 5, 10, 'GND'), pad('TP2', 25, 10, 'GND'),
  h('text', { layer: 'F.SilkS', at: '15 3', size: 1 }, 'rev 2'),
  h('zone', { layer: 'B.Cu', net: 'GND', d: 'M 1 1 H 29 V 19 H 1 Z' })))

test('inspect --layer F.SilkS: texts with their strokes, drawings with their arcs, each with ink bounds and source', () => {
  const r = inspectBoard(board(), 'pcb.tsx', '/', undefined, { layer: 'silk' })
  assert.equal(r.found, true)
  assert.equal(r.json.layer, 'F.SilkS', 'the alias resolves')
  const t = r.json.items.find(i => i.kind === 'text')
  assert.equal(t.text, 'rev 2')
  assert.ok(t.strokes.length > 3 && t.strokes.every(s => s.bounds && s.pts.length >= 2))
  assert.ok(t.bounds.x[0] < 15 && t.bounds.x[1] > 15, 'centred on its at')
  assert.ok('src' in t, 'src is null without the JSX dev runtime')
  const d = r.json.items.filter(i => i.kind === 'drawing')
  assert.deepEqual(d.map(i => i.ref).sort(), ['TP1', 'TP2'])
  assert.equal(d[0].prims[0][0].kind, 'arc')
  // the arc's ink runs half its width past its ends
  const tp1 = d.find(i => i.ref === 'TP1')
  assert.deepEqual(tp1.bounds.x, [3.9, 6.1])
  assert.ok(r.text.some(l => /^layer F\.SilkS  Front silkscreen  3 items: /.test(l)))
  assert.ok(r.text.some(l => l.includes('"rev 2"') && l.includes('strokes')))
  assert.ok(r.text.some(l => l.includes('1 arc')))
})

test('inspect --layer: a query filters by part, mask and paste give the Gerber openings, edge and an unknown layer', () => {
  const b = board()
  const tp = inspectBoard(b, 'pcb.tsx', '/', 'TP1', { layer: 'F.SilkS' })
  assert.deepEqual(tp.json.items.map(i => i.ref), ['TP1'])
  const mask = inspectBoard(b, 'pcb.tsx', '/', undefined, { layer: 'F.Mask' }).json.items
  assert.equal(mask.length, 2)
  assert.ok(mask[0].bounds.x[1] - mask[0].bounds.x[0] > 1, 'the opening is the pad grown by the mask expansion')
  const edge = inspectBoard(b, 'pcb.tsx', '/', undefined, { layer: 'edge' }).json
  assert.equal(edge.layer, 'Edge.Cuts')
  assert.equal(edge.items.length, 1)
  const zone = inspectBoard(b, 'pcb.tsx', '/', undefined, { layer: 'B.Cu' }).json.items.find(i => i.kind === 'zone')
  assert.ok(zone.fill.area > 400 && zone.fill.pieces === 1)
  const bad = inspectBoard(b, 'pcb.tsx', '/', undefined, { layer: 'Nope' })
  assert.equal(bad.found, false)
  assert.match(bad.text.at(-1), /unknown layer "Nope"/)
})

test('inspect <net>: one zone line per layer with fill area, pieces and islands removed, the same in --json', () => {
  const r = inspectBoard(board(), 'pcb.tsx', '/', 'GND')
  const [z] = r.json.zones
  assert.equal(z.layer, 'B.Cu')
  assert.equal(z.pieces, 1)
  assert.ok(z.area > 400 && z.area < 28 * 18, `area ${z.area}`)
  assert.deepEqual(z.islandsRemoved, { count: 0, area: 0 })
  assert.ok(r.text.some(l => /^\s+B\.Cu\s+\d+\.\d\d mm²\s+1\s+0\s+#\d+$/.test(l)), r.text.join('\n'))
})

test('inspectRequests: --layer lists the layer, each query filters it, --lengths beside it adds its tables', () => {
  assert.deepEqual(inspectRequests([], undefined, ['F.SilkS']).requests, [{ layer: 'F.SilkS' }])
  assert.deepEqual(inspectRequests(['pcb.tsx', 'U1'], undefined, ['F.SilkS', 'B.SilkS']), { entry: 'pcb.tsx', requests: [{ query: 'U1', layer: 'F.SilkS' }, { query: 'U1', layer: 'B.SilkS' }] })
  assert.deepEqual(inspectRequests([], ['D'], ['F.SilkS']).requests, [{ layer: 'F.SilkS' }, { query: 'D', lengths: true }])
})

test('inspect <net>: the copper area per layer in the header, pads, vias, tracks and fill unioned with the drills cut out', () => {
  const r = inspectBoard(board(), 'pcb.tsx', '/', 'GND')
  const fcu = r.json.copper.find(c => c.layer === 'F.Cu')
  // two round pads of 1 mm with 0.5 mm drills
  assert.ok(Math.abs(fcu.area - 2 * Math.PI * (0.25 - 0.0625)) < 0.02, `F.Cu ${fcu.area}`)
  const bcu = r.json.copper.find(c => c.layer === 'B.Cu')
  const fill = r.json.zones[0].fill
  assert.equal(fill.length, 1)
  assert.equal(fill[0].area, r.json.zones[0].area)
  // the fill runs over its own pads, so the union is the fill with the two drills cut out and the pad rims added
  const drills = 2 * Math.PI * 0.0625
  assert.ok(bcu.area >= fill[0].area - drills - 0.01 && bcu.area < fill[0].area + 2 * Math.PI * 0.25, `B.Cu ${bcu.area}, fill ${fill[0].area}`)
  assert.match(r.text.find(l => l.startsWith('net GND')), /  copper F\.Cu 1\.\d mm², B\.Cu \d+\.\d mm²$/)
})

test('inspect <net>: stitch() vias say stitch as their route in the text and in --json', () => {
  const b = compileBoard(h(PCB, { name: 'Stitched' },
    h('path', { layer: 'Edge.Cuts', d: 'M 0 0 H 30 V 20 H 0 Z' }),
    pad('TP1', 5, 10, 'GND'),
    h('zone', { layer: 'F.Cu', net: 'GND', d: 'M 1 1 H 29 V 19 H 1 Z' }),
    h('zone', { layer: 'B.Cu', net: 'GND', d: 'M 1 1 H 29 V 19 H 1 Z' }),
    stitch('GND', { pitch: 5 })))
  const r = inspectBoard(b, 'pcb.tsx', '/', 'GND')
  assert.ok(r.json.vias.length > 4)
  assert.ok(r.json.vias.every(v => v.route === 'stitch'), JSON.stringify(r.json.vias[0]))
  assert.equal(r.json.stitch.count, r.json.vias.length)
  assert.ok(r.text.some(l => /^\s+#\d+\s.*\sstitch$/.test(l)), r.text.join('\n'))
})
