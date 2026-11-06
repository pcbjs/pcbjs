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
function fixture(boards = [make()], layout = boards[0]) {
  let release,
    run = 1,
    loads = 0,
    recompile = false
  const pending = new Promise(r => (release = r))
  const events = [],
    viewer = { by: () => null, event: (name, data) => events.push({ name, data }) }
  const rt = {
    root: '/p',
    state: { slots: [{ entry: { file: '/p/pcb.tsx' }, compiled: boards.map(board => ({ board })) }] },
    stale: () => false,
    current: () => ({ run }),
    compiledOnce: async () => {
      if (recompile) {
        run++
        recompile = false
      }
    },
    compiler: () => ({
      layout: async () => {
        loads++
        await pending
        return { board: layout, site: {} }
      },
    }),
  }
  const tools = viewerTools({ shared: { session: { id: 'test' } }, sources: {}, runtimes: () => [rt], runtimeOfClient: () => rt, viewersOf: () => [viewer], lsp: () => null })
  return {
    events,
    release,
    recompile: () => {
      recompile = true
    },
    advance: () => run++,
    loads: () => loads,
    select: p => tools.views['session/select']({ board: 'B', ...p }, viewer),
  }
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
for (const cancel of ['blur', 'unchanged blur', 'target', 'refs blur']) {
  test(`pending library selection cannot outlive ${cancel}`, async () => {
    const f = fixture([make('First'), make('Second')])
    if (cancel === 'unchanged blur') f.select({ selection: emptySelection('B') })
    const pending = f.select({ selection: library('CH1/R') })
    if (cancel === 'target') await f.select({ target: 'Second', refs: ['D1'] })
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

test('a reference selection waiting for library geometry cannot supersede blur', async () => {
  const f = fixture()
  f.release()
  await f.select({ selection: library('CH1/R') })
  f.advance()
  const pending = f.select({ refs: ['D1'] })
  f.select({ selection: emptySelection('B') })
  assert.equal((await pending).anchor, null)
  assert.equal(f.events.at(-1).data.selection.isolate, null)
})

test('library selection survives the freshness compile needed to load its geometry', async () => {
  const f = fixture()
  f.recompile()
  const pending = f.select({ selection: library('CH1/R') })
  f.release()
  const selected = await pending
  assert.equal(selected.anchor, 'CH1/R')
  assert.equal(selected.isolate.mode, 'library')
})

for (const blur of [false, true]) {
  test(`library loading retries newer geometry${blur ? ' without restoring cancelled focus' : ' before acknowledging focus'}`, async () => {
    const f = fixture()
    const pending = f.select({ selection: library('CH1/R') })
    await Promise.resolve()
    assert.equal(f.loads(), 1)
    f.advance()
    if (blur) f.select({ selection: emptySelection('B') })
    f.release()
    const selected = await pending
    assert.equal(f.loads(), 2, 'resolve against the current compile before accepting the intent')
    if (blur) {
      assert.equal(selected, null)
      assert.equal(f.events.at(-1).data.selection.isolate, null)
    } else {
      assert.equal(selected.anchor, 'CH1/R')
      assert.equal(selected.isolate.mode, 'library')
    }
  })
}
