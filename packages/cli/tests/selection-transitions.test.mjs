import { test } from 'node:test'
import assert from 'node:assert/strict'
import { viewerTools } from '../dist/session/viewers.js'
import { emptySelection } from '@pcbjs/core/internal/selection'

const make = target => ({
  name: 'B',
  ...(target ? { variant: { name: target, index: target === 'First' ? 0 : 1 } } : {}),
  items: [],
  nets: [],
  footprints: ['R1', 'D1', 'TP1'].map(ref => ({ ref, pads: [], at: [0, 0] })),
  drc: [],
  erc: [],
  schematic: {
    parts: [
      { ref: 'R1', path: ['CH1'], local: 'R' },
      { ref: 'D1', path: ['CH1'], local: 'D' },
      { ref: 'TP1', path: [], local: 'TP1' },
    ],
    circuits: [{ path: ['CH1'] }],
  },
})
function fixture(boards = [make()]) {
  let release,
    run = 1
  const pending = new Promise(r => (release = r))
  const events = [],
    viewer = { by: () => null, event: (name, data) => events.push({ name, data }) }
  const rt = {
    root: '/p',
    state: { slots: [{ entry: { file: '/p/pcb.tsx' }, compiled: boards.map(board => ({ board })) }] },
    stale: () => false,
    current: () => ({ run }),
    compiledOnce: async () => {},
    compiler: () => ({
      layout: async () => {
        await pending
        return { board: boards[0], site: {} }
      },
    }),
  }
  const tools = viewerTools({ shared: { session: { id: 'test' } }, sources: {}, runtimes: () => [rt], runtimeOfClient: () => rt, viewersOf: () => [viewer], lsp: () => null })
  return { events, release, advance: () => run++, select: p => tools.views['session/select']({ board: 'B', ...p }, viewer) }
}
const library = ref => ({
  ...emptySelection('B'),
  refs: [ref],
  anchor: ref,
  level: 'CH1',
  isolate: { ref: 'CH1', context: 'CH1', instances: ['CH1'], preview: false, mode: 'library' },
})

test('latest library selection wins while the shared layout is loading', async () => {
  const f = fixture()
  const first = f.select({ selection: library('CH1/R'), base: 0 })
  const last = f.select({ selection: library('CH1/D'), base: 0 })
  f.release()
  assert.equal(await first, null)
  assert.equal((await last).anchor, 'CH1/D')
  assert.equal(f.events.filter(e => e.name === 'pcbjs:select').at(-1).data.selection.anchor, 'CH1/D')
})
for (const cancel of ['blur', 'unchanged blur', 'target', 'compile', 'refs blur']) {
  test(`pending library selection cannot outlive ${cancel}`, async () => {
    const f = fixture([make('First'), make('Second')])
    if (cancel === 'unchanged blur') f.select({ selection: emptySelection('B') })
    const pending = f.select({ selection: library('CH1/R') })
    if (cancel === 'target') await f.select({ target: 'Second', refs: ['D1'] })
    else if (cancel === 'compile') f.advance()
    else if (cancel === 'refs blur') await f.select({ refs: [] })
    else f.select({ selection: emptySelection('B') })
    f.release()
    assert.equal(await pending, null)
    assert.ok(!f.events.some(e => e.data.selection?.isolate?.mode === 'library'))
  })
}
test('a stale-base offer does not cancel a newer pending intent', async () => {
  const f = fixture()
  const pending = f.select({ selection: library('CH1/R'), base: 4 })
  assert.equal(f.select({ selection: emptySelection('B'), base: 3 }), null)
  f.release()
  assert.equal((await pending).anchor, 'CH1/R')
})
test('target changes clear previous finding, isolation and snapshot before validation', async () => {
  const a = make('First'),
    b = make('Second')
  a.drc = [{ id: 'drc:clearance:0123456789ab', refs: ['R1'] }]
  b.schematic.circuits = []
  b.schematic.parts = b.schematic.parts.filter(p => !p.path.length)
  b.footprints = b.footprints.filter(p => p.ref === 'TP1')
  const f = fixture([a, b])
  f.select({
    selection: {
      ...emptySelection('B', 'First'),
      finding: a.drc[0].id,
      snapshot: 'test.1',
      isolate: { ref: 'CH1', context: 'CH1', instances: ['CH1'], preview: false, mode: 'instance' },
    },
  })
  const next = await f.select({ target: 'Second', refs: ['TP1'] })
  assert.equal(next.target, 'Second')
  assert.equal(next.anchor, 'TP1')
  assert.equal(next.finding, null)
  assert.equal(next.isolate, null)
  assert.equal(next.snapshot, '')
})
