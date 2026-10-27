// The viewer's view query, the pair and length helpers it reads routes with, the pair fields of the site items, and the
// helpers of `pcbjs shot`. The client modules are imported straight from their TypeScript.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EXPLODE_MAX, findLayer, hasViewQuery, parseViewQuery, queryMode, soloHidden } from '@pcbjs/viewer/src/query.ts'
import { lengthStatus, netLengths, pairNets, pairOf, routeHover, routesOf, targetText } from '@pcbjs/viewer/src/routes.ts'
import { siteData } from '@pcbjs/export/site-data'
import { chromeCandidates, findChrome, parseSize, shotJobs, shotQuery, shotSuffix } from '@pcbjs/cli/shot'
import { compileBoard, h, PCB, outline } from './fixtures.mjs'

test('view query: view, explode, layer, select, side and theme, bad values dropped', () => {
  assert.deepEqual(parseViewQuery('?view=3D&explode=0.5&layer=F.Cu&select=U1&side=Bottom&theme=dark'), { view: '3d', explode: 0.5, layer: 'F.Cu', select: 'U1', side: 'bottom', theme: 'dark' })
  assert.deepEqual(parseViewQuery(''), { view: null, explode: null, layer: null, select: null, side: null, theme: null })
  assert.deepEqual(parseViewQuery('?view=iso&explode=x&layer=&side=under&theme=hc'), { view: null, explode: null, layer: null, select: null, side: null, theme: null })
  assert.equal(hasViewQuery(parseViewQuery('?side=bottom')), true)
  assert.equal(parseViewQuery('?explode=4').explode, 1, 'clamped to 0..1')
  assert.equal(parseViewQuery('?explode=-1').explode, 0)
  assert.equal(hasViewQuery(parseViewQuery('?ide=1')), false)
  assert.equal(hasViewQuery(parseViewQuery('?select=R1')), true)
  // explode alone opens the 3D view; an explicit view wins
  assert.equal(queryMode(parseViewQuery('?explode=0.3')), '3d')
  assert.equal(queryMode(parseViewQuery('?explode=0.3&view=2d')), '2d')
  assert.equal(queryMode(parseViewQuery('?layer=top')), null)
  assert.equal(EXPLODE_MAX, 15)
})

test('view query: a layer by id, alias or name, shown alone with the outline', () => {
  const layers = [{ id: 'F.Cu', name: 'Top', kind: 'copper' }, { id: 'B.Cu', name: 'Bottom', kind: 'copper' }, { id: 'F.SilkS', kind: 'silkscreen' }, { id: 'Edge.Cuts', kind: 'edge' }]
  assert.equal(findLayer(layers, 'f.cu'), 'F.Cu')
  assert.equal(findLayer(layers, 'bottom'), 'B.Cu')
  assert.equal(findLayer(layers, 'silk'), 'F.SilkS')
  assert.equal(findLayer(layers, 'In1.Cu'), null)
  assert.deepEqual(soloHidden(layers, 'back'), ['F.Cu', 'F.SilkS'])
  assert.equal(soloHidden(layers, 'nope'), null)
})

// two pair tracks, P on DP and N on DN, and a single ended track on CLK
const board = {
  items: [
    { id: 1, kind: 'track', net: 'DP', pair: 'p1', role: 'P', width: 0.2 },
    { id: 2, kind: 'track', net: 'DN', pair: 'p1', role: 'N', width: 0.2 },
    { id: 3, kind: 'track', net: 'DP', pair: 'p1', role: 'P', width: 0.2 },
    { id: 4, kind: 'track', net: 'CLK', width: 0.25 },
    { id: 5, kind: 'pad', net: 'DP' },
  ],
  routes: [
    { id: 'r1', net: 'DP', pair: 'p1', length: 30.1234, skew: 0.04, target: { min: 30, max: 30.2 } },
    { id: 'r2', net: 'CLK', length: 41.5, target: { min: 42, max: 42 }, group: 'DQ' },
  ],
}

test('routes: the two tracks and nets of a pair, and the routes of a track', () => {
  assert.equal(pairOf(board.items[1]), 'p1')
  assert.equal(pairOf(board.items[3]), null)
  assert.equal(pairOf(board.items[4]), null)
  assert.deepEqual(pairNets(board, 'p1'), ['DP', 'DN'])
  assert.deepEqual(routesOf(board, board.items[1]).map(r => r.id), ['r1'])
  assert.deepEqual(routesOf(board, board.items[3]).map(r => r.id), ['r2'])
  assert.deepEqual(routesOf({ items: board.items }, board.items[3]), [], 'data without routes')
})

test('routes: hover text with net, width, length, skew and target', () => {
  assert.equal(routeHover(board, board.items[1]), 'DN, 0.2 mm wide, length 30.12 mm, skew 0.04 mm, target 30 to 30.2 mm')
  assert.equal(routeHover(board, board.items[3]), 'CLK, 0.25 mm wide, length 41.5 mm, target 42 mm, too short, group DQ')
  assert.equal(routeHover(board, board.items[4]), null, 'a pad keeps its hover')
  assert.equal(routeHover({ items: board.items }, board.items[0]), null)
})

test('routes: length status, target text and the Nets list lengths with the N net of a pair', () => {
  assert.equal(lengthStatus({ length: 5, target: null }), null)
  assert.equal(lengthStatus({ length: 5, target: { min: 4, max: 6 } }), 'ok')
  assert.equal(lengthStatus({ length: 7, target: { min: 4, max: 6 } }), 'long')
  assert.equal(targetText({ min: 2, max: 2 }), '2 mm')
  const m = netLengths(board)
  assert.deepEqual([...m.keys()].sort(), ['CLK', 'DN', 'DP'])
  assert.equal(m.get('DN').length, 30.1234)
  assert.equal(m.get('DP').bad, false)
  assert.equal(m.get('CLK').bad, true)
  assert.equal(m.get('CLK').routes, 1)
  assert.equal(netLengths({ items: [] }).size, 0)
})

test('site data: tracks carry their width, and pair and role when the compiler set them', () => {
  const b = compileBoard(h(PCB, { name: 'Pairs' }, outline(), h('track', { net: 'A', layer: 'F.Cu', width: 0.3, d: 'M2 2 L7 2' }), h('track', { net: 'B', layer: 'F.Cu', width: 0.3, d: 'M2 4 L7 4' })))
  const tracks = b.items.filter(it => it.kind === 'track')
  tracks[0].pair = 'x'; tracks[0].role = 'P'; tracks[1].pair = 'x'; tracks[1].role = 'N'
  const s = siteData(b, { root: '/', fabUrl: '', fabName: '', fabFiles: [], fabStatus: 'ok', svgUrl: '', dev: false, bom: [] })
  const items = s.items.filter(it => it.kind === 'track')
  assert.deepEqual(items.map(it => [it.pair, it.role, it.width]), [['x', 'P', 0.3], ['x', 'N', 0.3]])
  assert.equal(s.routes, undefined, 'nothing produces routes yet')
})

test('shot: browser lookup, the query, the size and one job per board, target and view', () => {
  assert.equal(chromeCandidates('darwin', { PCBJS_CHROME: '/x/chrome', HOME: '/Users/a' })[0], '/x/chrome')
  assert.ok(chromeCandidates('darwin', {}).includes('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'))
  assert.ok(chromeCandidates('linux', { PATH: '/opt/bin' }).includes('/opt/bin/chromium'))
  assert.ok(chromeCandidates('win32', { PROGRAMFILES: 'C:\\PF' }).some(p => p.endsWith('msedge.exe')))
  assert.equal(findChrome('linux', { PATH: '/opt/bin' }, p => p === '/usr/bin/chromium'), '/usr/bin/chromium')
  assert.equal(findChrome('linux', { PATH: '' }, () => false), null)
  assert.equal(shotQuery('2d', { explode: 0.5, layer: 'F.Cu', theme: 'dark' }), '?view=2d&layer=F.Cu&theme=dark')
  assert.equal(shotQuery('3d', { explode: 0.5, select: 'U1' }), '?view=3d&explode=0.5&select=U1')
  assert.equal(shotQuery('3d', { select: 'U1', side: 'bottom' }), '?view=3d&select=U1&side=bottom')
  assert.equal(shotQuery('2d', { side: 'top' }), '?view=2d', 'top is the default and adds nothing')
  assert.deepEqual(parseSize('1600x1000'), [1600, 1000])
  assert.equal(parseSize('16x10'), null)
  assert.equal(parseSize('wide'), null)
  const jobs = shotJobs([{ name: 'Blinky', targets: [null] }, { name: 'Multi', targets: ['JLCPCB 2-Layer', 'House'] }], ['2d', '3d'], '/o')
  assert.deepEqual(jobs.map(j => j.file), ['/o/Blinky-2d.png', '/o/Blinky-3d.png', '/o/Multi-jlcpcb-2-layer-2d.png', '/o/Multi-jlcpcb-2-layer-3d.png', '/o/Multi-house-2d.png', '/o/Multi-house-3d.png'])
  assert.equal(jobs[2].path, '/board/Multi/jlcpcb-2-layer')
  // the options are in the name, so shots with other options never overwrite each other; explode is 3D only
  const o = { explode: 0.6, select: 'U1', layer: 'F.Cu', theme: 'dark' }
  assert.deepEqual(shotJobs([{ name: 'Blinky', targets: [null] }], ['2d', '3d'], '/o', o).map(j => j.file), ['/o/Blinky-2d-select-U1-F.Cu-dark.png', '/o/Blinky-3d-explode60-select-U1-F.Cu-dark.png'])
  assert.equal(shotSuffix('2d'), '')
  assert.equal(shotSuffix('3d', { explode: 0 }), '-explode0')
  assert.equal(shotSuffix('3d', { select: 'U1', side: 'bottom', theme: 'dark' }), '-select-U1-bottom-dark')
  assert.equal(shotSuffix('2d', { side: 'top' }), '')
})
