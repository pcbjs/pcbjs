// The components as built into dist: each renders on the server with no browser global, two views of one board share one store,
// and a `?pcb:board` ref loads its facets as views want them and keeps its store, selection included, when a newer ref replaces it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { joinSite, splitSite, facetHash } from '@pcbjs/core/site-facets'
import * as ui from '../dist/index.js'
import { fixture } from './fixture-board.mjs'
import { fakeTransport } from './fake-transport.mjs'

const board = () =>
  joinSite({
    meta: {
      ...fixture(),
      rules: { clearance: 0.2 },
      copper: 2,
      thickness: 1.6,
      viewBox: [0, 0, 30, 30],
      bbox: { x: 0, y: 0, w: 30, h: 30 },
      outline: [
        [
          [0, 0],
          [30, 0],
          [30, 30],
          [0, 30],
        ],
      ],
      airwires: [],
      sourcingTags: [],
    },
  })

const render = component => renderToString(createSSRApp({ render: () => h(component, { board: board() }) }))

test('every component renders on the server without window, document or three.js', async () => {
  assert.equal(typeof window, 'undefined')
  for (const name of [
    'View2D',
    'View3D',
    'SchView',
    'PcbViewer',
    'PathChip',
    'FindingsList',
    'LayersPanel',
    'BoardPanel',
    'StackupPanel',
    'SheetPanel',
    'SchematicPanel',
    'BomPanel',
    'NetsPanel',
    'CircuitPanel',
    'PartPanel',
  ]) {
    const html = await render(ui[name])
    assert.equal(typeof html, 'string', name)
  }
  assert.match(await render(ui.View2D), /class="pcbjs-ui pcbjs-view stage/)
  assert.match(await render(ui.FindingsList), /clearance/)
  assert.match(await render(ui.PcbViewer), /class="app pcbjs-ui pcbjs-viewer/)
  assert.match(await render(ui.PcbViewer), /Read-only/)
  assert.match(await render(ui.View2D), /Read-only/)
})

test('two components given one board share its store: a selection made in one shows in the other', () => {
  const b = board()
  const a = ui.useBoard(b),
    c = ui.useBoard(b)
  assert.equal(a, c)
  a.selectRef('R1')
  assert.deepEqual([...c.sel.refs], ['R1'])
  assert.notEqual(ui.useBoard(board()), a, 'another data object is another board')
})

test('locked placements remain selectable and show a lock badge', async () => {
  for (const locked of [true, false]) {
    const b = board()
    b.edit = [{ ref: 'R1', locked, caps: ['move'], src: {}, m: [1, 0, 0, 1, 0, 0], grid: null }]
    const store = ui.useBoard(b)
    store.selectRef('R1')
    assert.equal(store.sel.anchor, 'R1')
    const html = await renderToString(createSSRApp({ render: () => h(ui.PathChip, { board: b }) }))
    assert.equal(html.includes('title="Placement locked in source"'), locked)
  }
})

test('stale compile failures expose source context directly without a details disclosure', async () => {
  const b = {
    ...board(),
    stale: true,
    staleError: 'pcb.tsx:9:4: pair route: P endpoints must be on the same net\n  J9/1: DATA_P\n  J1/2: DATA_N\n\n> 9 |   {route(a, b)}\n    |    ^^^^^^^^^^^',
  }
  const html = await renderToString(createSSRApp({ render: () => h(ui.PcbViewer, { board: b }) }))
  assert.match(html, /role="alert"/)
  assert.match(html, /aria-label="Source context"/)
  assert.match(html, /J9\/1: DATA_P/)
  assert.match(html, /pcb\.tsx:9:4/)
  assert.doesNotMatch(html, /<details|<summary/)
})

test('halted boards show a failed progress segment and incomplete checks instead of a clean result', async () => {
  const b = {
    ...board(),
    drc: [],
    erc: [],
    unconnected: 0,
    halted: { stage: 'place', stages: ['evaluate', 'place', 'checks', 'exports'], completed: ['evaluate'], src: { file: 'pcb.tsx', line: 9, col: 4 } },
    staleError: 'pcb.tsx:9:4: pair endpoints disagree',
  }
  const html = await renderToString(createSSRApp({ render: () => h(ui.PcbViewer, { board: b }) }))
  assert.match(html, /role="progressbar"/)
  assert.match(html, /aria-valuenow="1"/)
  assert.match(html, /class="failed"/)
  assert.match(html, /Partial board before the failing expression/)
  assert.match(html, /DRC \/ ERC incomplete/)
  const checks = await renderToString(createSSRApp({ render: () => h(ui.FindingsList, { board: b, kinds: ['drc', 'erc'] }) }))
  assert.match(checks, /compilation halted/)
  assert.doesNotMatch(checks, /No findings|clean/)
})

test('a ref loads the facets a view wants; a newer ref refetches them into the same store and keeps the selection', async () => {
  const site = board()
  const parts = splitSite(site)
  const served = new Map()
  const fetched = []
  globalThis.fetch = async url => {
    fetched.push(url)
    return { ok: true, json: async () => served.get(url) }
  }
  const ref = (n, title) => {
    const urls = {}
    for (const f of Object.keys(parts)) {
      urls[f] = `/f/${n}/${f}.json`
      served.set(urls[f], f === 'meta' ? { ...parts.meta, title } : parts[f])
    }
    return { kind: 'pcbjs-board', format: 1, entry: '/p/pcb.tsx', board: 'Fx', target: null, run: n, summary: {}, facets: urls, poster: { '2d': '' }, live: true }
  }
  const s = ui.useBoard(ref(1, 'One'))
  assert.equal(s.state, 'poster')
  s.want(ui.VIEW_FACETS['2d'])
  await new Promise(r => setTimeout(r, 10))
  assert.deepEqual(fetched.sort(), ['/f/1/findings.json', '/f/1/layers.json', '/f/1/meta.json'])
  assert.equal(s.state, 'ready')
  assert.equal(s.site.title, 'One')
  s.selectRef('R2')
  assert.equal(ui.useBoard(ref(2, 'Two')), s, 'the same store')
  await new Promise(r => setTimeout(r, 10))
  assert.equal(s.run, 2)
  assert.equal(s.site.title, 'Two')
  assert.deepEqual([...s.sel.refs], ['R2'])
  assert.ok(fetched.includes('/f/2/layers.json') && !fetched.includes('/f/2/sch.json'), 'what was fetched, again, and nothing more')
  assert.equal(facetHash(s.facets.layers), facetHash(parts.layers))
  delete globalThis.fetch
})

test('a live ref follows its session: a newer ref fetches nothing, a facet frame redraws it, an invalidate marks it stale until the compile ends', async () => {
  const site = { ...board(), name: 'Lv' }
  const parts = splitSite(site)
  const fetched = []
  globalThis.fetch = async url => {
    fetched.push(url)
    return { ok: true, json: async () => parts[/\/(\w+)\.json$/.exec(url)[1]] }
  }
  const urls = Object.fromEntries(Object.keys(parts).map(f => [f, `/lv/${f}.json`]))
  const session = { path: '/@pcbjs/session/k', scope: null }
  const ref = n => ({ kind: 'pcbjs-board', format: 1, entry: '/p/lv.tsx', board: 'Lv', target: null, run: n, summary: {}, facets: urls, poster: { '2d': '' }, live: true, session })
  const t = fakeTransport()
  const reg = globalThis[Symbol.for('pcbjs.boards')]
  const open = reg.transport
  reg.transport = r => (r.session?.path === session.path ? t : null)
  // the board module runs before any view asks for its board, and again on every hot replacement
  reg.live(ref(1))
  const s = ui.useBoard(ref(1))
  s.want(['meta', 'layers'])
  await new Promise(r => setTimeout(r, 10))
  assert.equal(s.site.title, site.title)
  const asked = fetched.length
  reg.live(ref(2))
  await new Promise(r => setTimeout(r, 10))
  assert.equal(s.run, 2)
  assert.equal(fetched.length, asked, 'the newer ref fetches nothing, its facets come in the stream')
  const meta = { ...parts.meta, title: 'Streamed' }
  t.emit('pcbjs:facet', { board: 'Lv', run: 3, facet: 'meta', stage: 'import', hash: facetHash(meta), data: meta })
  assert.equal(s.site.title, 'Streamed')
  t.emit('pcbjs:invalidate', { board: 'Lv', run: 3, refs: ['R1'], uids: [], findings: [], edit: 3 })
  assert.ok(s.stale.refs.has('R1'), 'R1 is stale until the compile ends')
  t.emit('pcbjs:facet', { board: 'Lv', run: 3, facet: 'meta', stage: 'import', hash: facetHash(parts.meta), data: parts.meta })
  assert.equal(s.site.title, 'Streamed', 'a facet of the run the edit made stale is dropped')
  t.emit('pcbjs:status', { phase: 'idle', run: 4 })
  assert.equal(s.stale.refs.size, 0)
  assert.ok(
    t.sent.some(([m, p]) => m === 'session/observe' && p.board === 'Lv'),
    'it observes its board, as a page does',
  )
  reg.transport = open
  delete globalThis.fetch
})

test('preview views, finding panels and selected chips never render full diagnostic sentences', async () => {
  const b = board()
  const detail = 'length-match match group DATA spreads 38.884 mm, full explanation belongs only in details'
  const base = { ...b.drc[0], rule: 'length-match', message: detail }
  b.drc = [
    base,
    {
      ...base,
      id: 'drc:route-failed:test',
      rule: 'route-failed',
      witness: {
        segments: [
          [
            [1, 2],
            [3, 4],
          ],
        ],
      },
    },
  ]
  b.erc = [{ ...base, id: 'erc:pin-type:test', rule: 'pin-type', layer: 'sch' }]
  const render = (component, props = {}) => renderToString(createSSRApp({ render: () => h(component, { board: b, ...props }) }))
  const panel = await render(ui.FindingsList, { kinds: ['drc', 'erc'] })
  assert.match(panel, /title="length-match"/)
  assert.match(panel, /route-failed/)
  assert.match(panel, /pin-type/)
  assert.ok(!panel.includes(detail), 'no row, title or accessibility attribute leaks the sentence')
  for (const component of [ui.View2D, ui.View3D, ui.SchView, ui.PcbViewer]) {
    const html = await render(component)
    assert.ok(!html.includes(detail), component.__name)
  }
  for (const finding of [...b.drc, ...b.erc]) {
    ui.useBoard(b).focusFinding(finding)
    const chip = await render(ui.PathChip)
    assert.ok(chip.includes(`title="${finding.rule}"`))
    assert.ok(!chip.includes(detail), 'selected finding chips remain concise')
  }
  assert.equal(b.drc[0].message, detail, 'full source data remains available to the HTML details pane')
})
