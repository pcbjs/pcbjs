// The viewer's IDE mode, imported straight from the client TypeScript: the query, the route that never shows the home page,
// and which board an editor focus switches to.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { embedGate, embedHover, embedViews, focusSwitch, ideRoute, pageUrl, parseIdeQuery, parseIdeRequest } from '../src/ide.ts'
import { routeFromPath } from '../src/variants.ts'

const names = ['Blinky', 'Coin', 'Quad', 'Multi']

test('ide query: ide=1 and the theme kinds light, dark and hc, nothing else', () => {
  assert.deepEqual(parseIdeQuery('?ide=1&theme=dark'), { ide: true, theme: 'dark', panel: true, view: null, embed: false, tools: true })
  assert.deepEqual(parseIdeQuery('?theme=light&ide=true'), { ide: false, theme: 'light', panel: true, view: null, embed: false, tools: true })
  assert.deepEqual(parseIdeQuery('?ide=1&theme=hc'), { ide: true, theme: 'hc', panel: true, view: null, embed: false, tools: true })
  assert.deepEqual(parseIdeQuery('?ide&theme=HC'), { ide: false, theme: null, panel: true, view: null, embed: false, tools: true })
  assert.deepEqual(parseIdeQuery('?ide=1&theme=hc-light'), { ide: true, theme: null, panel: true, view: null, embed: false, tools: true })
  assert.deepEqual(parseIdeQuery('?ide=1&theme=purple'), { ide: true, theme: null, panel: true, view: null, embed: false, tools: true })
  assert.deepEqual(parseIdeQuery('?ide=0&theme=dark'), { ide: false, theme: 'dark', panel: true, view: null, embed: false, tools: true })
  assert.deepEqual(parseIdeQuery(''), { ide: false, theme: null, panel: true, view: null, embed: false, tools: true })
})

test('ide query: panel=0 hides the right-hand panel for an editor that shows it itself', () => {
  assert.equal(parseIdeQuery('?ide=1&panel=0').panel, false)
  assert.equal(parseIdeQuery('?ide=1&panel=false&view=3d').panel, true)
  assert.equal(parseIdeQuery('?ide=1&panel=1').panel, true)
  assert.equal(parseIdeQuery('?ide=1&panel=0&view=3d').view, '3d')
  assert.equal(parseIdeQuery('?ide=1&view=board').view, null)
})

test('ide request: a net to pin or a finding to focus by its exact id, anything else ignored', () => {
  assert.deepEqual(parseIdeRequest({ type: 'pcbjs:net', board: 'Blinky', net: 'GND' }), { kind: 'net', board: 'Blinky', net: 'GND' })
  assert.deepEqual(parseIdeRequest({ type: 'pcbjs:net', net: null }), { kind: 'net', board: null, net: null })
  const id = 'erc:sch-unwired:0123456789ab'
  assert.deepEqual(parseIdeRequest({ type: 'pcbjs:finding', board: 'Coin', id }), { kind: 'finding', board: 'Coin', id })
  const bad = [
    null,
    'x',
    { type: 'pcbjs:net' },
    { type: 'pcbjs:finding', at: [3, 4] },
    { type: 'pcbjs:finding', id: 'drc:short' },
    { type: 'pcbjs:finding', id: 'net:GND' },
    { type: 'other', net: 'GND' },
  ]
  for (const b of bad) assert.equal(parseIdeRequest(b), null)
})

test('embed query: ?embed=1 like ?ide=1, beside the view and theme', () => {
  assert.deepEqual(parseIdeQuery('?embed=1&view=3d&theme=dark'), { ide: false, theme: 'dark', panel: true, view: '3d', embed: true, tools: true })
  assert.equal(parseIdeQuery('?embed=1').embed, true)
  for (const v of ['?embed', '?embed=true', '?embed=yes', '?embed=0', '', '?ide=1']) assert.equal(parseIdeQuery(v).embed, false)
})

test('embed query: tools=0 hides the view toolbars, shown by default', () => {
  assert.equal(parseIdeQuery('?embed=1&tools=0').tools, false)
  for (const v of ['?embed=1', '?embed=1&tools=1', '?embed=1&tools', '?embed=1&tools=false', '?embed=1&tools=no']) assert.equal(parseIdeQuery(v).tools, true)
  const search = '?embed=1&tools=0&view=3d'
  assert.equal(pageUrl('/board/Multi/house', parseIdeQuery(search), search), '/board/Multi/house?embed=1&tools=0&view=3d')
})

test('embed request: view, theme, hover and select from the page around the frame', () => {
  assert.deepEqual(parseIdeRequest({ type: 'pcbjs:view', view: 'sch' }), { kind: 'view', view: 'sch', side: null, mirror: null })
  assert.deepEqual(parseIdeRequest({ type: 'pcbjs:view', view: '2d', side: 'B', mirror: true }), { kind: 'view', view: '2d', side: 'B', mirror: true })
  assert.deepEqual(parseIdeRequest({ type: 'pcbjs:view', side: 'F' }), { kind: 'view', view: null, side: 'F', mirror: null })
  assert.deepEqual(parseIdeRequest({ type: 'pcbjs:view', mirror: false }), { kind: 'view', view: null, side: null, mirror: false })
  assert.deepEqual(parseIdeRequest({ type: 'pcbjs:theme', theme: 'light' }), { kind: 'theme', theme: 'light' })
  const uids = ['item:0123456789ab', 'item:0123456789ab~2']
  assert.deepEqual(parseIdeRequest({ type: 'pcbjs:hover', uids, refs: ['U1'], net: 'GND' }), { kind: 'hover', hover: { uids, refs: ['U1'], net: 'GND' } })
  assert.deepEqual(parseIdeRequest({ type: 'pcbjs:hover', uids: [], refs: [], net: 'VBUS' }), { kind: 'hover', hover: { uids: [], refs: [], net: 'VBUS' } })
  assert.deepEqual(parseIdeRequest({ type: 'pcbjs:hover', uids: [], refs: [], net: null }), { kind: 'hover', hover: null })
  assert.deepEqual(parseIdeRequest({ type: 'pcbjs:select', refs: ['R1'], frame: true }), { kind: 'select', refs: ['R1'], frame: true, by: 'viewer' })
  assert.deepEqual(parseIdeRequest({ type: 'pcbjs:select', refs: ['CH2/R01/2', 'net:GND'] }), { kind: 'select', refs: ['CH2/R01/2', 'net:GND'], frame: false, by: 'viewer' })
  assert.deepEqual(parseIdeRequest({ type: 'pcbjs:select', refs: ['R1'], by: 'tree' }), { kind: 'select', refs: ['R1'], frame: false, by: 'tree' })
  assert.deepEqual(parseIdeRequest({ type: 'pcbjs:select', refs: [] }), { kind: 'select', refs: null, frame: false, by: 'viewer' })
  assert.deepEqual(parseIdeRequest({ type: 'pcbjs:select', refs: null }), { kind: 'select', refs: null, frame: false, by: 'viewer' })
  for (const bad of [
    { type: 'pcbjs:view', view: 'board' },
    { type: 'pcbjs:view', side: 'bottom', mirror: 1 },
    { type: 'pcbjs:theme', theme: 'hc' },
    { type: 'pcbjs:hover', ids: [1], refs: [], net: null },
    { type: 'pcbjs:hover', uids: [], refs: [3], net: null },
    { type: 'pcbjs:hover', refs: [], net: null },
    { type: 'pcbjs:select' },
    { type: 'pcbjs:select', ref: 'R1' },
    { type: 'pcbjs:select', refs: [3] },
  ])
    assert.equal(parseIdeRequest(bad), null)
})

test('embed gate: ready once the first view shown has painted, then a view per switch once it has painted', () => {
  const g = embedGate('Blinky', ['2d', '3d', 'sch'])
  assert.equal(g.painted('3d'), null)
  g.shown('3d')
  assert.equal(g.painted('2d'), null)
  assert.deepEqual(g.painted('3d'), { type: 'pcbjs:ready', board: 'Blinky', views: ['2d', '3d', 'sch'] })
  assert.equal(g.painted('3d'), null)
  g.shown('2d')
  assert.equal(g.painted('3d'), null)
  assert.deepEqual(g.painted('2d'), { type: 'pcbjs:view', view: '2d', side: 'F', mirror: false })
  assert.equal(g.painted('2d'), null)
  g.shown('sch')
  g.shown('3d')
  assert.equal(g.painted('sch'), null)
  assert.deepEqual(g.painted('3d'), { type: 'pcbjs:view', view: '3d', side: 'F', mirror: false })
})

test('embed gate: a view message carries the side on top and the mirror of the moment', () => {
  const look = { side: 'F', mirror: false }
  const g = embedGate('Blinky', ['2d', '3d'], () => ({ ...look }))
  g.shown('2d')
  g.painted('2d')
  look.side = 'B'
  look.mirror = true
  g.shown('3d')
  assert.deepEqual(g.painted('3d'), { type: 'pcbjs:view', view: '3d', side: 'B', mirror: true })
})

test('page url: IDE and embed mode keep the whole query on a rewritten path, a plain site none', () => {
  const search = '?embed=1&view=3d&theme=dark&select=U1'
  assert.equal(pageUrl('/board/Multi/osh-park-2-layer', parseIdeQuery(search), search), '/board/Multi/osh-park-2-layer?embed=1&view=3d&theme=dark&select=U1')
  assert.equal(pageUrl('/board/Multi', parseIdeQuery('?ide=1&panel=0'), '?ide=1&panel=0'), '/board/Multi?ide=1&panel=0')
  assert.equal(pageUrl('/board/Multi', parseIdeQuery('?view=3d'), '?view=3d'), '/board/Multi')
})

test('embed messages: the views a board has and the hover the frame posts', () => {
  assert.deepEqual(embedViews(true), ['2d', '3d', 'sch', 'checks'])
  assert.deepEqual(embedViews(false), ['2d', '3d', 'checks'])
  assert.deepEqual(embedHover({ uids: ['item:0123456789ab'], refs: ['C1'], net: 'VCC' }), { type: 'pcbjs:hover', uids: ['item:0123456789ab'], refs: ['C1'], net: 'VCC' })
  assert.deepEqual(embedHover(null), { type: 'pcbjs:hover', uids: [], refs: [], net: null })
})

test('ide route: the home path never shows the home page, it shows the focused board or the first', () => {
  const home = routeFromPath('/', '/')
  assert.deepEqual(home, { page: 'home' })
  assert.deepEqual(ideRoute(home, names, null), { page: 'board', name: 'Blinky', target: null })
  assert.deepEqual(ideRoute(home, names, 'Coin'), { page: 'board', name: 'Coin', target: null })
  assert.deepEqual(ideRoute(home, names, 'Gone'), { page: 'board', name: 'Blinky', target: null })
  // no boards yet: still not home, the stage shows the compile state
  assert.deepEqual(ideRoute(home, [], null), { page: 'board', name: null, target: null })
})

test('ide route: a board path keeps its board and target, an unknown one falls back instead of "No such board"', () => {
  assert.deepEqual(ideRoute(routeFromPath('/board/Multi/jlcpcb', '/'), names, null), { page: 'board', name: 'Multi', target: 'jlcpcb' })
  assert.deepEqual(ideRoute(routeFromPath('/board/Renamed', '/'), names, 'Quad'), { page: 'board', name: 'Quad', target: null })
  assert.deepEqual(ideRoute({ page: 'board', name: null, target: null }, names, null), { page: 'board', name: 'Blinky', target: null })
  // before the boards arrive an unknown name is kept, so the route does not jump once they do
  assert.deepEqual(ideRoute(routeFromPath('/board/Coin', '/'), [], null), { page: 'board', name: 'Coin', target: null })
})

test('ide focus: switches to the first board that imports the file unless the board shown imports it too', () => {
  // the cursor sequence of the demo: main.tsx, then lib/MyGroup.tsx, then coin.tsx
  let cur = 'Blinky'
  assert.equal(focusSwitch(cur, { board: 'Blinky', entry: 'main.tsx', file: 'main.tsx', boards: ['Blinky'] }, names), null)
  assert.equal(focusSwitch(cur, { board: 'Blinky', entry: 'main.tsx', file: 'lib/MyGroup.tsx', boards: ['Blinky'] }, names), null)
  cur = focusSwitch(cur, { board: 'Coin', entry: 'coin.tsx', file: 'coin.tsx', boards: ['Coin'] }, names) ?? cur
  assert.equal(cur, 'Coin')
  // a shared library imported by the board shown keeps it, even when an earlier board imports it as well
  assert.equal(focusSwitch('Multi', { board: 'Blinky', entry: 'main.tsx', file: 'lib/MyPart.tsx', boards: ['Blinky', 'Coin', 'Multi'] }, names), null)
  // without the boards list, as a host that only sends the contract fields, it goes to the named board
  assert.equal(focusSwitch('Multi', { board: 'Blinky', entry: 'main.tsx', file: 'lib/MyPart.tsx' }, names), 'Blinky')
  // a file no board imports, or a board the viewer does not have, keeps the board
  assert.equal(focusSwitch('Coin', { board: null, entry: null, file: 'README.md', boards: [] }, names), null)
  assert.equal(focusSwitch('Coin', { board: 'Elsewhere', entry: 'x.tsx', file: 'x.tsx' }, names), null)
  // from the home path, nothing shown yet
  assert.equal(focusSwitch(null, { board: 'Quad', entry: 'quad.pcb.tsx', file: 'quad.pcb.tsx', boards: ['Quad'] }, names), 'Quad')
})

test('host identity preserves explicit first or named target and rejects malformed targets', () => {
  for (const message of [
    { type: 'pcbjs:select', refs: ['R1'] },
    { type: 'pcbjs:net', net: 'GND' },
    { type: 'pcbjs:finding', id: 'erc:sch-unwired:0123456789ab' },
    { type: 'pcbjs:view', view: '2d' },
    { type: 'pcbjs:hover', uids: [], refs: [], net: null },
  ]) {
    for (const target of [null, 'house']) {
      const parsed = parseIdeRequest({ ...message, board: 'Blinky', target })
      assert.equal(parsed.board, 'Blinky')
      assert.equal(parsed.target, target)
    }
    assert.equal('target' in parseIdeRequest(message), false)
    assert.equal(parseIdeRequest({ ...message, target: 3 }), null)
  }
})

test('host identity-only view switches context without specifying a view', () => {
  assert.deepEqual(parseIdeRequest({ type: 'pcbjs:view', board: 'Gx', target: null }), { kind: 'view', board: 'Gx', target: null, view: null, side: null, mirror: null })
})


test('the dedicated checks view parses in browser and IDE host messages', () => {
  assert.equal(parseIdeQuery('?ide=1&view=checks').view, 'checks')
  assert.deepEqual(parseIdeRequest({ type: 'pcbjs:view', view: 'checks' }), { kind: 'view', view: 'checks', side: null, mirror: null })
})
