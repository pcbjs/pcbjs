import { test } from 'node:test'
import assert from 'node:assert/strict'
import { viewerTools } from '../dist/session/viewers.js'
import { sessionHub } from '../dist/session/hub.js'

function fixture(nested = false) {
  const roots = ['/projects/alpha', nested ? '/projects/alpha/beta' : '/projects/beta']
  const runtimes = roots.map((root, i) => ({
    root,
    scope: { slug: i ? 'beta' : 'alpha' },
    state: { slots: [{ entry: { file: `${root}/pcb.tsx` }, compiled: [{ board: { name: 'Same' } }] }] },
    reaches: file => file.startsWith(`${root}/`) || file === '/shared/lib.tsx',
    stale: () => false,
    current: () => ({ run: 1 }),
    facets: { lacking: () => [] },
  }))
  const viewers = runtimes.map(rt => ({
    observe: { scope: rt.scope.slug, board: 'Same', target: null, facets: [] },
    got: [],
    event(event, data) {
      this.got.push({ event, ...data })
    },
    by: () => null,
  }))
  const runtimeOfClient = c => runtimes.find(rt => (c.observe ? rt.scope.slug === c.observe.scope : rt.root === c.hello?.project))
  const viewersOf = (root, board) => viewers.filter(c => runtimeOfClient(c)?.root === root && (!board || c.observe.board === board))
  const h = {
    shared: {},
    sources: {},
    runtimes: () => runtimes,
    runtimeOfClient,
    projectOf: c => runtimeOfClient(c)?.root,
    realOf: file => file,
    viewers: () => viewers,
    viewersOf,
    sendTo: (root, event, data, board) => viewersOf(root, board).forEach(c => c.event(event, data)),
    payload: () => ({ boards: [] }),
    focusFor: () => null,
    lsp: () => null,
    beatTo() {},
    demand() {},
  }
  const tools = viewerTools(h)
  const context = (i, file = `${roots[i]}/pcb.tsx`) => ({ project: roots[i], board: 'Same', file, command: 'H', start: [i, 0] })
  const clear = () => viewers.forEach(c => c.got.splice(0))
  return { roots, runtimes, viewers, tools, context, clear }
}

test('assist, completion focus, grid and hover stay in their project with duplicate board names', () => {
  const { roots, viewers, tools, context, clear } = fixture()
  const a = context(0),
    b = context(1)
  tools.assist(a.file, [a])
  assert.equal(viewers[0].got[0].assist.file, a.file)
  assert.deepEqual(viewers[1].got, [])
  tools.assist(b.file, [b])
  assert.equal(viewers[1].got[0].assist.file, b.file)
  clear()
  tools.endFocus(a.file, [{ project: roots[0], board: 'Same', handle: 'TP1[1]' }])
  tools.grid(roots[0], 'Same', 'A')
  tools.views['session/hover']({ board: 'Same', hover: { ref: 'TP1' } }, viewers[0])
  assert.deepEqual(
    viewers[0].got.map(m => m.event),
    ['pcbjs:assist:focus', 'pcbjs:grid'],
  )
  assert.deepEqual(viewers[1].got, [])
  clear()
  tools.close(a.file)
  assert.deepEqual(viewers[0].got, [
    { event: 'pcbjs:assist', board: 'Same', assist: null },
    { event: 'pcbjs:assist:focus', board: 'Same', handle: null },
  ])
  assert.deepEqual(viewers[1].got, [])
  delete viewers[1].observe
  tools.views['session/observe']({ board: 'Same', scope: 'beta', facets: [] }, viewers[1])
  assert.equal(viewers[1].got.find(m => m.event === 'pcbjs:assist').assist.file, b.file)
})

test('an observe switches projects even when the board name stays the same, clearing old tools', () => {
  const { viewers, tools, context, clear } = fixture()
  const a = context(0)
  tools.assist(a.file, [a])
  clear()
  tools.views['session/observe']({ board: 'Same', scope: 'beta', facets: [] }, viewers[0])
  assert.deepEqual(
    viewers[0].got.filter(m => ['pcbjs:assist', 'pcbjs:assist:focus', 'pcbjs:grid'].includes(m.event)),
    [
      { event: 'pcbjs:assist', board: 'Same', assist: null },
      { event: 'pcbjs:assist:focus', board: 'Same', handle: null },
      { event: 'pcbjs:grid', board: 'Same', grid: null },
    ],
  )
})

test('shared-file assist cleanup preserves the other project and a dropped runtime loses its tools', async () => {
  const { roots, viewers, tools, context, clear } = fixture()
  const file = '/shared/lib.tsx',
    a = context(0, file),
    b = context(1, file)
  tools.assist(file, [a, b])
  tools.endFocus(
    file,
    roots.map(project => ({ project, board: 'Same', handle: 'TP1[1]' })),
  )
  clear()
  tools.assist(file, [b])
  tools.endFocus(file, [{ project: roots[1], board: 'Same', handle: 'TP1[1]' }])
  assert.equal(viewers[0].got.find(m => m.event === 'pcbjs:assist').assist, null)
  assert.ok(!viewers[1].got.some(m => m.event === 'pcbjs:assist'))
  tools.drop(roots[1])
  assert.equal(viewers[1].got.find(m => m.event === 'pcbjs:assist').assist, null)
  await assert.rejects(tools.views['session/edit/begin']({ tool: 'assist', board: 'Same' }, viewers[1]), /cursor waits for no argument/)
})

test('a nested project assist cannot begin an edit in its parent project', async () => {
  const { viewers, tools, context } = fixture(true)
  const b = context(1)
  tools.assist(b.file, [b])
  assert.deepEqual(viewers[0].got, [])
  await assert.rejects(tools.views['session/edit/begin']({ tool: 'assist', board: 'Same' }, viewers[0]), /cursor waits for no argument/)
  const begun = await tools.views['session/edit/begin']({ tool: 'assist', board: 'Same' }, viewers[1])
  assert.match(begun.txn, /^beta:/)
  assert.throws(() => tools.views['session/edit/update']({ txn: begun.txn, point: { at: [1, 1] } }, viewers[0]), /another project/)
})

test('unknown or dropped explicit scopes and projects never fall back to the recent project', async () => {
  const scopes = [
    { slug: 'alpha', dir: '/projects/alpha' },
    { slug: 'beta', dir: '/projects/beta' },
  ]
  const ws = { folders: ['/projects'], scopes, recent: scopes[0] }
  const h = sessionHub({ watcher: { on() {} } }, ws, { slots: [], session: { id: 'test' } }, '/client')
  assert.equal(h.projectOf({ observe: { scope: 'gone' } }), null)
  assert.equal(h.projectOf({ hello: { project: '/projects/gone' } }), null)
  assert.equal(h.projectOf({ hello: { project: '/projects/alpha/not-a-project' } }), null)
  assert.equal(h.projectOf({ hello: { role: 'editor', project: '/projects' } }), '/projects/alpha')
  assert.equal(h.projectOf({ hello: { role: 'cli', project: '/projects' } }), null)
  assert.equal(h.projectOf({ hello: { role: 'editor', project: '/projects' }, observe: { scope: 'gone' } }), null)
  const stale = { observe: { scope: 'beta', board: 'Same' } }
  assert.equal(h.projectOf(stale), '/projects/beta')
  ws.scopes.splice(1, 1)
  assert.equal(h.projectOf(stale), null)
  const { viewers, tools } = fixture()
  viewers[0].observe.scope = 'gone'
  assert.throws(() => tools.views['session/edit/begin']({ tool: 'assist', board: 'Same' }, viewers[0]), /no longer available/)
  assert.throws(() => tools.views['session/select']({ board: 'Same', refs: ['TP1'] }, viewers[0]), /no longer available/)
})

for (const operation of ['update', 'commit', 'cancel']) {
  for (const replace of [false, true]) {
    test(`stale ${operation} after ${replace ? 'reattach' : 'reload'} cannot consume another client's transaction`, async () => {
      const { roots, runtimes, viewers, tools, context } = fixture()
      const a = context(0)
      const second = { ...viewers[0], got: [] }
      tools.assist(a.file, [a])
      const old = await tools.views['session/edit/begin']({ tool: 'assist', board: 'Same' }, viewers[0])
      tools.drop(roots[0])
      if (replace) runtimes[0] = { ...runtimes[0] }
      tools.assist(a.file, [a])
      const next = await tools.views['session/edit/begin']({ tool: 'assist', board: 'Same' }, second)
      assert.notEqual(old.txn, next.txn)
      await assert.rejects(async () => tools.views[`session/edit/${operation}`]({ txn: old.txn, point: { at: [1, 1] } }, viewers[0]), /no edit/)
      assert.equal(tools.views['session/edit/cancel']({ txn: next.txn }, second), null)
    })
  }
}

test('a divergent second target refuses source tools and switching targets clears tool state', async () => {
  const { runtimes, viewers, tools, context, clear } = fixture()
  const rt = runtimes[0]
  rt.state.slots[0].compiled[0].board.variant = { name: 'First', index: 0, names: ['First', 'Second'] }
  rt.state.slots[0].compiled.push({ board: { name: 'Same', variant: { name: 'Second', index: 1 }, edit: [{ ref: 'SecondOnly' }] } })
  const a = context(0)
  tools.assist(a.file, [a])
  clear()
  tools.views['session/observe']({ board: 'Same', scope: 'alpha', target: 'Second', facets: [] }, viewers[0])
  assert.ok(viewers[0].got.some(m => m.event === 'pcbjs:grid' && m.grid === null))
  await assert.rejects(async () => tools.views['session/edit/begin']({ tool: 'assist', board: 'Same' }, viewers[0]), /target is read-only/)
  tools.views['session/observe']({ board: 'Same', scope: 'alpha', target: 'First', facets: [] }, viewers[0])
  const first = await tools.views['session/edit/begin']({ tool: 'assist', board: 'Same' }, viewers[0])
  assert.ok(first.txn)
})

for (const role of ['editor', 'agent']) {
  test(`${role} edit requests without observe validate the requested target`, async () => {
    const { roots, runtimes, viewers, tools, context } = fixture()
    const board = runtimes[0].state.slots[0].compiled[0].board
    board.variant = { name: 'First', index: 0, names: ['First', 'Second'] }
    runtimes[0].state.slots[0].compiled.push({ board: { name: 'Same', variant: { name: 'Second', index: 1 } } })
    const a = context(0)
    tools.assist(a.file, [a])
    const client = { hello: { role, project: roots[0] }, by: () => null }
    const begin = target => tools.views['session/edit/begin']({ tool: 'assist', board: 'Same', target }, client)
    assert.throws(() => begin('Second'), /target is read-only/)
    assert.throws(() => begin('Missing'), /unknown target/)
    const first = await begin('First')
    assert.ok(first.txn)
    viewers[0].observe.target = 'First'
    assert.throws(() => tools.views['session/edit/begin']({ tool: 'assist', board: 'Same', target: 'Second' }, viewers[0]), /requested target differs/)
    assert.throws(() => tools.views['session/edit/begin']({ tool: 'assist', board: 'Same', target: 'Missing' }, viewers[0]), /requested target differs/)
  })
}

test('finding focus opens checks without source reveal, affected entity reveals its target source', async () => {
  const { viewerTools } = await import('../dist/session/viewers.js')
  const { emptySelection } = await import('@pcbjs/core/internal/selection')
  const src = { file: 'second.tsx', line: 2, col: 3, endLine: 2, endCol: 8 }
  const make = name => ({
    name: 'B',
    variant: { name, index: name === 'First' ? 0 : 1 },
    items: [],
    nets: [],
    footprints: [{ ref: 'R1', pads: [], src: { ...src, file: name === 'First' ? 'first.tsx' : src.file } }],
    drc: [{ id: 'drc:clearance:0123456789ab', refs: ['R1'] }],
    erc: [],
  })
  const rt = { root: '/p', state: { slots: [{ compiled: [{ board: make('First') }, { board: make('Second') }] }] }, stale: () => false }
  const events = [],
    calls = [],
    viewer = { by: () => null, event() {} }
  const tools = viewerTools({
    shared: { clients: { relay: (event, data) => events.push(data) } },
    sources: {},
    runtimes: () => [rt],
    runtimeOfClient: () => rt,
    viewersOf: () => [viewer],
    lsp: () => ({ keys: () => ['editor'], select: (...args) => calls.push(args) }),
  })
  const selection = { ...emptySelection('B', 'Second'), finding: 'drc:clearance:0123456789ab', refs: ['drc:clearance:0123456789ab'], anchor: 'drc:clearance:0123456789ab' }
  tools.views['session/select']({ board: 'B', selection }, viewer)
  await new Promise(r => setImmediate(r))
  assert.equal(calls.length, 0)
  tools.views['session/select']({ board: 'B', selection: { ...selection, refs: ['R1'], anchor: 'R1' } }, viewer)
  await new Promise(r => setImmediate(r))
  assert.equal(events.at(-1).target, 'Second')
  assert.equal(events.at(-1).finding.id, 'drc:clearance:0123456789ab')
  assert.equal(calls.length, 1)
  assert.equal(calls[0][1][0].file, '/p/second.tsx')
})

test('lazy library requests validate ownership and share only the matching target/run cache', async () => {
  const { runtimes, viewers, tools } = fixture()
  let run = 1,
    calls = 0
  const rt = runtimes[0]
  rt.compiledOnce = async () => {}
  rt.current = () => ({ run })
  rt.state.slots[0].compiled[0].board.edit = [{ ref: 'CH1' }]
  rt.state.slots[0].compiled[0].board.schematic = { circuits: [{ path: ['CH1'] }] }
  rt.compiler = () => ({ layout: async (entry, board, target, ref) => ({ site: { entry, board, target, ref, call: ++calls }, board: {} }) })
  const params = { board: 'Same', target: null, ref: 'CH1' }
  const first = await tools.views['session/layout'](params, viewers[0])
  const replay = await tools.views['session/layout'](params, viewers[0])
  assert.equal(first.call, 1)
  assert.equal(replay.call, 1)
  assert.equal(first.entry.file, '/projects/alpha/pcb.tsx')
  run = 2
  assert.equal((await tools.views['session/layout'](params, viewers[0])).call, 2)
  rt.state.slots[0].compiled[0].board.schematic.circuits.push({ kind: 'group', path: ['Divider'] })
  assert.equal((await tools.views['session/layout']({ ...params, ref: 'Divider' }, viewers[0])).ref, 'Divider')
  await assert.rejects(tools.views['session/layout']({ ...params, target: 'missing' }, viewers[0]), /no layout/)
  await assert.rejects(tools.views['session/layout']({ ...params, ref: 'missing' }, viewers[0]), /no layout/)
  await assert.rejects(tools.views['session/layout']({ ...params, target: 3 }, viewers[0]), /needs board/)
})

test('library entity source reveal uses the shared source beneath an own placement', async () => {
  const { emptySelection } = await import('@pcbjs/core/internal/selection')
  const src = file => ({ file, line: 2, col: 3, endLine: 2, endCol: 8 })
  const original = {
    name: 'B',
    items: [],
    nets: [],
    footprints: [{ ref: 'R1', pads: [], src: src('override.tsx') }],
    drc: [],
    erc: [],
    schematic: { circuits: [{ path: ['CH1'] }] },
  }
  const baseline = { ...original, footprints: [{ ...original.footprints[0], src: src('shared.tsx') }] }
  const calls = [],
    rt = {
      root: '/p',
      state: { slots: [{ entry: { file: '/p/pcb.tsx' }, compiled: [{ board: original }] }] },
      stale: () => false,
      compiledOnce: async () => {},
      current: () => ({ run: 1 }),
      compiler: () => ({ layout: async () => ({ board: baseline, site: {} }) }),
    }
  const viewer = { by: () => null, event() {} }
  const tools = viewerTools({
    shared: {},
    sources: {},
    runtimes: () => [rt],
    runtimeOfClient: () => rt,
    viewersOf: () => [viewer],
    lsp: () => ({ keys: () => ['editor'], select: (...args) => calls.push(args) }),
  })
  tools.views['session/select'](
    {
      board: 'B',
      selection: { ...emptySelection('B'), refs: ['R1'], anchor: 'R1', level: 'CH1', isolate: { ref: 'CH1', context: 'CH1', instances: ['CH1'], preview: false, mode: 'library' } },
    },
    viewer,
  )
  await new Promise(r => setImmediate(r))
  assert.equal(calls.length, 1)
  assert.equal(calls[0][1][0].file, '/p/shared.tsx')
})

test('selection offers validate board, target, snapshot and references before broadcasting', async () => {
  const { emptySelection } = await import('@pcbjs/core/internal/selection')
  const { runtimes, viewers, tools } = fixture()
  const board = {
    name: 'Same',
    items: [],
    nets: [],
    footprints: [{ ref: 'R1', pads: [] }],
    drc: [],
    erc: [],
    schematic: { parts: [{ ref: 'R1', path: ['CH1'], local: 'R' }], circuits: [{ path: ['CH1'] }] },
  }
  runtimes[0].state.slots[0].compiled[0].board = board
  const select = selection => tools.views['session/select']({ board: selection.board, selection }, viewers[0])
  const state = { ...emptySelection('Same'), refs: ['CH1', 'R1', 'CH1/R'], anchor: 'R1' }
  assert.throws(() => select({ ...state, board: 'Missing' }), /no board/)
  assert.throws(() => select({ ...state, target: 'missing' }), /no board/)
  assert.throws(() => select({ ...state, snapshot: 'garbage' }), /snapshot/)
  assert.throws(() => select({ ...state, refs: ['not a ref'] }), /name/)
  assert.throws(() => select({ ...state, refs: ['R999'] }), /R999/)
  assert.equal(viewers[0].got.length, 0)
  const accepted = select(state)
  assert.deepEqual(accepted.refs, ['CH1/R'])
  assert.equal(accepted.anchor, 'CH1/R')
  const ancestor = select({ ...state, anchor: 'CH1' })
  assert.deepEqual(ancestor.refs, ['CH1'])
  const variant = { ...board, variant: { name: 'Second', index: 1 } }
  runtimes[0].state.slots[0].compiled.push({ board: variant })
  const target = await tools.views['session/select']({ board: 'Same', target: 'Second', refs: ['R1'] }, viewers[0])
  assert.equal(target.target, 'Second')
})
