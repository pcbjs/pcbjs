// The viewer's grouping of fab targets and its board routes, imported straight from the client TypeScript.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  appBase,
  assetUrl,
  boardPath,
  drcSummary,
  failingCount,
  groupBoards,
  hashToPath,
  isAppPath,
  parseBoardHash,
  pickTarget,
  routeFromPath,
  sameEntry,
  targetBySlug,
  targetName,
  upsertEntry,
  variantSlug,
  withForeign,
  worstTarget,
} from '../src/variants.ts'

const names = ['JLCPCB 2-Layer', 'OSH Park 2-Layer', 'Aisler & Co/4L?']
const v = (i, extra = {}) => ({ name: 'Blinky', variant: { name: names[i], index: i, names }, drc: [], unconnected: 0, ...extra })
const err = { severity: 'error', rule: 'clearance', message: 'x', at: [0, 0] }
const warn = { severity: 'warning', rule: 'silk', message: 'y', at: [0, 0] }

test('entries group by board name in first-appearance order, targets by variant index', () => {
  const coin = { name: 'Coin', drc: [], unconnected: 0 }
  const g = groupBoards([v(2), coin, v(0), v(1)])
  assert.deepEqual(
    g.map(x => x.name),
    ['Blinky', 'Coin'],
  )
  assert.deepEqual(g[0].targets.map(targetName), names)
  assert.deepEqual(g[1].targets, [coin])
  assert.equal(targetName(coin), null)
})

test('a target is picked by name, else the first', () => {
  const ts = [v(0), v(1), v(2)]
  assert.equal(pickTarget(ts, names[1]), ts[1])
  assert.equal(pickTarget(ts, 'nope'), ts[0])
  assert.equal(pickTarget(ts, null), ts[0])
  assert.equal(pickTarget([], null), null)
})

test('an update replaces only the entry with the same name and target', () => {
  const coin = { name: 'Coin' }
  const list = [v(0), v(1), coin]
  const next = v(1, { generatedAt: 'new' })
  assert.equal(upsertEntry(list, next), 1)
  assert.equal(list[1], next)
  assert.equal(list.length, 3)
  assert.equal(upsertEntry(list, v(2)), 2)
  assert.deepEqual(
    list.map(b => b.variant?.name ?? b.name),
    [names[0], names[1], names[2], 'Coin'],
  )
  assert.equal(upsertEntry(list, { name: 'Quad' }), 4)
  const newCoin = { name: 'Coin', x: 1 }
  upsertEntry(list, newCoin)
  assert.equal(list[3], newCoin)
  assert.ok(sameEntry({ name: 'A' }, { name: 'A' }))
  assert.ok(!sameEntry(v(0), v(1)))
})

test('DRC summaries of targets: the worst one and how many fail', () => {
  const ts = [v(0), v(1, { drc: [warn] }), v(2, { drc: [err, err] }), v(0, { drc: [err] })]
  assert.equal(worstTarget(ts), ts[2])
  assert.equal(worstTarget([v(0), v(1, { drc: [warn] })]).variant.index, 1)
  assert.equal(worstTarget([v(0), v(1)]).variant.index, 0)
  assert.equal(worstTarget([v(0, { unconnected: 1 }), v(1, { drc: [warn] })]).variant.index, 0)
  assert.equal(failingCount(ts), 2)
  assert.equal(drcSummary(ts[2]).text, '2 errors')
  assert.equal(drcSummary(v(0)).state, 'ok')
})

test('target slugs match the compiler: lowercase, runs of other characters one dash, none at the ends', () => {
  assert.equal(variantSlug('JLCPCB 2-Layer'), 'jlcpcb-2-layer')
  assert.equal(variantSlug('  Aisler & Co/4L?'), 'aisler-co-4l')
  const ts = [v(0), v(1), v(2)]
  assert.equal(targetBySlug(ts, 'osh-park-2-layer'), ts[1])
  assert.equal(targetBySlug(ts, 'nope'), null)
  assert.equal(targetBySlug([{ name: 'Coin' }], 'coin'), null)
})

test('routes are paths under the base', () => {
  assert.deepEqual(routeFromPath('/', '/'), { page: 'home' })
  assert.deepEqual(routeFromPath('/index.html', '/'), { page: 'home' })
  assert.deepEqual(routeFromPath('/board/Blinky', '/'), { page: 'board', name: 'Blinky', target: null })
  assert.deepEqual(routeFromPath('/board/Blinky/', '/'), { page: 'board', name: 'Blinky', target: null })
  assert.deepEqual(routeFromPath('/board/Blinky/jlcpcb-2-layer?x=1#y', '/'), { page: 'board', name: 'Blinky', target: 'jlcpcb-2-layer' })
  assert.deepEqual(routeFromPath('/board/Blinky/jlcpcb-2-layer/index.html', '/'), { page: 'board', name: 'Blinky', target: 'jlcpcb-2-layer' })
  assert.deepEqual(routeFromPath('/board/My%20Board%2F2', '/'), { page: 'board', name: 'My Board/2', target: null })
  assert.deepEqual(routeFromPath('/board/bad%zz', '/'), { page: 'board', name: 'bad%zz', target: null })
  assert.deepEqual(routeFromPath('/site/board/Coin', '/site/'), { page: 'board', name: 'Coin', target: null })
  assert.deepEqual(routeFromPath('/site', '/site/'), { page: 'home' })
  assert.deepEqual(routeFromPath('/board/Coin', '/site/'), { page: 'home' })
  assert.deepEqual(routeFromPath('/board/a/b/c', '/'), { page: 'home' })
  assert.ok(isAppPath('/site/', '/site/') && isAppPath('/site/board/x', '/site/') && isAppPath('/site/index.html', '/site/'))
  assert.ok(!isAppPath('/__pcbjs/Blinky/fab/x.zip', '/') && !isAppPath('/other/', '/site/'))
})

test('board paths, the base of a built site and its relative URLs', () => {
  assert.equal(boardPath('/', 'Blinky'), '/board/Blinky')
  assert.equal(boardPath('/site', 'My Board?', 'OSH Park 2-Layer'), '/site/board/My%20Board%3F/osh-park-2-layer')
  const p = boardPath('/', 'Blinky', names[2])
  assert.deepEqual(routeFromPath(p, '/'), { page: 'board', name: 'Blinky', target: variantSlug(names[2]) })
  assert.equal(appBase('/', '/board/Blinky/x'), '/')
  assert.equal(appBase('/site', '/site/'), '/site/')
  assert.equal(appBase('./', '/site/board/Blinky/jlcpcb-2-layer'), '/site/')
  assert.equal(appBase('./', '/site/board/Blinky/'), '/site/')
  assert.equal(appBase('./', '/site/index.html'), '/site/')
  assert.equal(appBase('', '/'), '/')
  assert.equal(assetUrl('fab/Blinky/fab/x.zip', '/site/'), '/site/fab/Blinky/fab/x.zip')
  assert.equal(assetUrl('/__pcbjs/Blinky/x.svg', '/site/'), '/__pcbjs/Blinky/x.svg')
  assert.equal(assetUrl('https://cdn.example/x.zip', '/'), 'https://cdn.example/x.zip')
})

test('old hash routes redirect to paths', () => {
  assert.deepEqual(parseBoardHash('#/board/Coin?x=1&target=OSH%20Park'), { name: 'Coin', target: 'OSH Park' })
  assert.equal(hashToPath('#/board/Blinky', '/'), '/board/Blinky')
  assert.equal(hashToPath('#/board/Blinky?target=JLCPCB%202-Layer', '/site/'), '/site/board/Blinky/jlcpcb-2-layer')
  assert.equal(hashToPath('#/', '/site/'), '/site/')
  assert.equal(hashToPath('#section', '/'), null)
})

test('hidden layers a target lacks are kept, not dropped', () => {
  const two = ['F.Cu', 'B.Cu', 'Edge.Cuts']
  const prev = new Set(['In1.Cu', 'F.Cu'])
  assert.deepEqual([...withForeign(prev, two, ['B.Cu'])].sort(), ['B.Cu', 'In1.Cu'])
  assert.deepEqual([...withForeign(prev, two, [])], ['In1.Cu'])
})

test('the client slug is the compiler slug', async t => {
  const lib = await import('@pcbjs/core').catch(() => ({}))
  if (typeof lib.variantSlug !== 'function') return t.skip('dist has no variantSlug yet')
  for (const n of ['JLCPCB 2-Layer', '  Aisler & Co/4L?', 'OSH Park', 'a--b__c', 'ÄÖ 4L']) assert.equal(variantSlug(n), lib.variantSlug(n), n)
})
