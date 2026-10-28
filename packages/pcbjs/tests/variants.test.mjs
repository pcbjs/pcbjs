import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import PCB, { h, route, variants, isVariants, variantSlug, resetDefaults, defineDefaultRules } from '@pcbjs/core'
import { compileBoard, compileBoards, CompileError } from '@pcbjs/compile'
import { buildFab } from '@pcbjs/export/fab'
import { siteData, sourceIndex } from '@pcbjs/export/site-data'
import { boardsIndex, boardsPayload, routeEndpoint, slotsFor, slugsOf, markConflicts } from '@pcbjs/cli/boards'
import { boardDir, boardFile, boardUrls } from '@pcbjs/cli/project'
import { pluginState, virtualModule } from '@pcbjs/cli/plugin'
import { JLCPCB, OSHPARK, BASE, resolveRules, withMaskColor } from '@pcbjs/lib/rules'
import { JLCPCB_2L, OSHPARK_2L } from '@pcbjs/lib/stackups'
import JLC2 from '@pcbjs/fab/JLCPCB/2-Layer'
import OSH2 from '@pcbjs/fab/OSHPark/2-Layer'

beforeEach(() => resetDefaults())

const HOUSE = { board: { thickness: 1.2 }, rules: { clearance: 0.2 }, color: 'black', name: 'House' }
// a resistor between two pads, one hand-drawn track and one autorouted
const design = (C, props = {}) =>
  h(
    C,
    { name: 'V', revision: 'A', ...props },
    h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 20, h: 12 }),
    h('footprint', { ref: 'TP1', at: '4mm 6mm', 'net:pad1': 'A' }, h('pad', { num: 1, size: 1.5, shape: 'circle' })),
    h(
      'footprint',
      { ref: 'R1', at: '10mm 6mm', 'net:pad1': 'A', 'net:pad2': 'B' },
      h('pad', { num: 1, at: '-0.8mm 0', size: [0.8, 0.9] }),
      h('pad', { num: 2, at: '0.8mm 0', size: [0.8, 0.9] }),
    ),
    h('footprint', { ref: 'TP2', at: '15mm 9mm', 'net:pad1': 'B' }, h('pad', { num: 1, size: 1.5, shape: 'circle' })),
    route({ net: 'A', layer: 'F.Cu', width: 0.3, d: 'M 4 6 H 9.2' }),
    route({ net: 'B', layer: 'F.Cu', width: 0.3, d: { start: 'R1.2', end: 'TP2.1' } }),
  )
const Multi = variants(JLC2, OSH2, HOUSE)

test('variants: three targets compile into three boards with their names, stackups and rules', () => {
  const boards = compileBoards(design(Multi))
  assert.deepEqual(
    boards.map(b => b.variant.name),
    ['JLCPCB 2-Layer', 'OSH Park 2-Layer', 'House'],
  )
  assert.deepEqual(
    boards.map(b => b.variant.index),
    [0, 1, 2],
  )
  for (const b of boards) assert.deepEqual(b.variant.names, ['JLCPCB 2-Layer', 'OSH Park 2-Layer', 'House'])
  assert.deepEqual(
    boards.map(b => b.variant.fab),
    ['JLCPCB', 'OSH Park', undefined],
  )
  assert.ok(boards.every(b => b.name === 'V' && b.revision === 'A'))
  const [j, o, hs] = boards
  assert.deepEqual(j.rules, withMaskColor(resolveRules(JLCPCB), j.stackup.maskColor))
  assert.deepEqual(o.rules, { ...OSHPARK })
  assert.deepEqual(hs.rules, { ...BASE, clearance: 0.2 })
  assert.equal(j.stackup.finish, JLCPCB_2L.finish)
  assert.equal(o.stackup.finish, OSHPARK_2L.finish)
  assert.equal(j.stackup.maskColor, 'Green')
  assert.equal(o.stackup.maskColor, 'Purple')
  assert.equal(hs.stackup.maskColor, 'black')
  assert.equal(hs.thickness, 1.2)
  for (const b of boards) assert.equal(b.drc.filter(d => d.severity === 'error').length, 0, b.variant.name)
  assert.ok(isVariants(Multi))
  assert.ok(Object.isFrozen(Multi.targets))
  assert.deepEqual(
    Multi.targets.map(t => t.name),
    ['JLCPCB 2-Layer', 'OSH Park 2-Layer', 'House'],
  )
  assert.equal(isVariants(JLC2), false)
})

test('variants: the element props win in every target, colours go through each palette', () => {
  const boards = compileBoards(design(Multi, { rules: { clearance: 0.3 }, color: 'black', finish: 'ENIG' }))
  assert.deepEqual(
    boards.map(b => b.rules.clearance),
    [0.3, 0.3, 0.3],
  )
  assert.deepEqual(
    boards.map(b => b.rules.minDrill),
    [JLCPCB.minDrill, OSHPARK.minDrill, BASE.minDrill],
  )
  assert.deepEqual(
    boards.map(b => b.stackup.maskColor),
    ['Black', 'black', 'black'],
    'JLCPCB spells it Black, OSH Park has no black, House passes through',
  )
  assert.ok(boards.every(b => b.stackup.finish === 'ENIG'))
})

test('variants: global default rules sit under the target, as with a preset', () => {
  defineDefaultRules({ clearance: 0.25, minDrill: 0.4 })
  const [j, , hs] = compileBoards(design(Multi))
  assert.equal(j.rules.clearance, JLCPCB.clearance)
  assert.equal(hs.rules.clearance, 0.2)
  assert.equal(hs.rules.minDrill, 0.4)
})

test('variants: names default to the preset name, else Target N; the plain PCB is Base', () => {
  const V = variants(PCB, { rules: { clearance: 0.2 } }, JLC2)
  assert.deepEqual(
    V.targets.map(t => t.name),
    ['Base', 'Target 2', 'JLCPCB 2-Layer'],
  )
  const [base] = compileBoards(design(V))
  assert.deepEqual(base.rules, { ...BASE })
})

test('variants: duplicate names throw a CompileError with the indices', () => {
  assert.throws(
    () => compileBoards(design(variants(JLC2, OSH2, JLC2))),
    e => e instanceof CompileError && /targets 1 and 3 are both named "JLCPCB 2-Layer"/.test(e.message),
  )
  assert.throws(() => compileBoards(design(variants({ name: 'A b' }, { name: 'a-B' }))), /targets 1 and 2.*share the file name a-b/)
})

test('variants: compileBoard on a variants root throws with the hint, compileBoards handles a single board', () => {
  assert.throws(() => compileBoard(design(Multi)), /use compileBoards/)
  const boards = compileBoards(design(JLC2))
  assert.equal(boards.length, 1)
  assert.equal(boards[0].variant, undefined)
})

test('variants: item ids and the source index are identical across targets', () => {
  const src = { file: 'multi.tsx', line: 1, col: 1, endLine: 1, endCol: 9 }
  const root = h(
    Multi,
    { name: 'V' },
    h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 20, h: 12, __src: src }),
    h('footprint', { ref: 'TP1', at: '4mm 6mm', 'net:pad1': 'A', __src: { ...src, line: 2 } }, h('pad', { num: 1, size: 1.5 })),
    h('footprint', { ref: 'TP2', at: '15mm 6mm', 'net:pad1': 'A', __src: { ...src, line: 3 } }, h('pad', { num: 1, size: 1.5 })),
    h('track', { net: 'A', layer: 'F.Cu', width: 0.3, d: 'M 4 6 H 15', __src: { ...src, line: 4 } }),
  )
  const boards = compileBoards(root)
  const shape = b => b.items.map(i => [i.id, i.kind, i.ref ?? null])
  const idx = b => sourceIndex(b, f => f)
  for (const b of boards.slice(1)) {
    assert.deepEqual(shape(b), shape(boards[0]))
    assert.deepEqual(idx(b), idx(boards[0]))
  }
  assert.ok(Object.keys(idx(boards[0])).length)
  // hand-drawn tracks are the same in every target
  const tracks = b => b.items.filter(i => i.kind === 'track').map(i => i.pts)
  assert.deepEqual(tracks(boards[2]), tracks(boards[0]))
})

test('variants: site data carries the variant, fab zips and README name the target', () => {
  const boards = compileBoards(design(Multi))
  const fabs = boards.map(b => buildFab(b, '2026-01-01T00:00:00Z'))
  assert.deepEqual(
    fabs.map(f => f.zipName),
    ['V-fab-A-jlcpcb-2-layer.zip', 'V-fab-A-osh-park-2-layer.zip', 'V-fab-A-house.zip'],
  )
  assert.match(fabs[1].readme.split('\n')[1], /^Target OSH Park 2-Layer, fab OSH Park, 2 of 3/)
  assert.match(fabs[2].readme.split('\n')[1], /^Target House, 3 of 3/)
  const single = buildFab(compileBoard(design(JLC2)), '2026-01-01T00:00:00Z')
  assert.equal(single.zipName, 'V-fab-A.zip')
  assert.match(single.readme.split('\n')[1], /^Generated/)
  const site = siteData(boards[1], { root: '/p', fabUrl: 'u', fabName: 'n', fabFiles: [], fabStatus: 'ok', svgUrl: 's', dev: false, bom: [] })
  assert.deepEqual(site.variant, { name: 'OSH Park 2-Layer', index: 1, names: ['JLCPCB 2-Layer', 'OSH Park 2-Layer', 'House'], fab: 'OSH Park' })
  assert.equal(variantSlug('OSH Park 2-Layer'), 'osh-park-2-layer')
})

test('variants: urls, boards.json, the payload and the dev routes for a variants board', () => {
  const boards = compileBoards(design(Multi))
  const entry = { file: '/p/multi.tsx', rel: 'multi.tsx' }
  const compiled = boards.map(board => {
    const [, slug] = boardDir(board)
    const zip = buildFab(board).zipName
    const urls = boardUrls(board.name, zip, true, slug)
    return { entry, board, site: { name: board.name, variant: board.variant, fab: { status: 'ok', url: urls.fab }, svgUrl: urls.svg } }
  })
  assert.deepEqual(boardUrls('V', 'V-fab-A-house.zip', true, 'house'), { fab: '/__pcbjs/V/house/fab/V-fab-A-house.zip', svg: '/__pcbjs/V/house/V.pcb.svg' })
  assert.deepEqual(boardUrls('V', 'V-fab-A-house.zip', false, 'house'), { fab: 'fab/V/house/V-fab-A-house.zip', svg: 'fab/V/house/V.pcb.svg' })
  assert.equal(boardFile(boards[1]), 'boards/V/osh-park-2-layer.json')
  assert.equal(boardFile({ name: 'Coin' }), 'boards/Coin.json')
  const coin = { entry: { file: '/p/coin.tsx', rel: 'coin.tsx' }, board: { name: 'Coin', title: 'Coin', revision: '1' }, site: { name: 'Coin', fab: { status: 'ok' } } }
  assert.deepEqual(
    boardsIndex([coin, ...compiled], false).boards.map(b => [b.name, b.variant, b.file]),
    [
      ['Coin', undefined, 'boards/Coin.json'],
      ['V', 'JLCPCB 2-Layer', 'boards/V/jlcpcb-2-layer.json'],
      ['V', 'OSH Park 2-Layer', 'boards/V/osh-park-2-layer.json'],
      ['V', 'House', 'boards/V/house.json'],
    ],
  )
  assert.equal('variant' in boardsIndex([coin], true).boards[0], false)

  const slots = slotsFor([coin.entry, entry])
  slots[0].compiled = [coin]
  slots[1].compiled = compiled
  markConflicts(slots)
  const p = boardsPayload(slots)
  assert.deepEqual(
    p.boards.map(b => [b.name, b.variant?.name ?? null]),
    [
      ['Coin', null],
      ['V', 'JLCPCB 2-Layer'],
      ['V', 'OSH Park 2-Layer'],
      ['V', 'House'],
    ],
  )
  assert.deepEqual(p.entries, { Coin: 'coin.tsx', V: 'multi.tsx' })
  assert.equal(p.single, false)
  assert.deepEqual(slugsOf(slots), { V: ['jlcpcb-2-layer', 'osh-park-2-layer', 'house'] })
  const names = ['Coin', 'V'],
    slugs = slugsOf(slots)
  assert.deepEqual(routeEndpoint('V/house/board.json', names, slugs), { name: 'V', variant: 'house', file: 'board.json' })
  assert.deepEqual(routeEndpoint('V/osh-park-2-layer/fab/V-fab-A-osh-park-2-layer.zip', names, slugs), {
    name: 'V',
    variant: 'osh-park-2-layer',
    file: 'fab/V-fab-A-osh-park-2-layer.zip',
  })
  assert.deepEqual(routeEndpoint('V/board.json', names, slugs), { name: 'V', variant: 'jlcpcb-2-layer', file: 'board.json' })
  assert.deepEqual(routeEndpoint('Coin/board.json', names, slugs), { name: 'Coin', file: 'board.json' })

  // the virtual module lists every target entry
  const state = pluginState({ entries: [entry] })
  state.slots[0].compiled = compiled
  const src = virtualModule(state)
  assert.match(src, /"House"/)
  assert.match(src, /export default \{"name":"V","variant":\{"name":"JLCPCB 2-Layer"/)
})
