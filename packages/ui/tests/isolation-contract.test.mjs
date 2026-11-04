import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
registerHooks({
  resolve(spec, ctx, next) {
    try {
      return next(spec, ctx)
    } catch (e) {
      if (spec.startsWith('.') && !spec.endsWith('.ts')) return next(spec + '.ts', ctx)
      throw e
    }
  },
})
const { isolate } = await import('../src/selection.ts')
import { emptySelection } from '@pcbjs/core/internal/selection'
import { viewerTools } from '../../cli/dist/session/viewers.js'

test('UI standalone footprint isolation is accepted and broadcast by the session', async () => {
  const board = {
    name: 'B',
    items: [],
    nets: [],
    footprints: [{ ref: 'TP1', at: [0, 0], pads: [] }],
    drc: [],
    erc: [],
    schematic: { parts: [{ ref: 'TP1', path: [], local: 'TP1' }], circuits: [] },
  }
  const selection = isolate({ ...emptySelection('B'), refs: ['TP1'], anchor: 'TP1' }, board)
  const events = [],
    viewer = { by: () => null, event: (name, data) => events.push(data) }
  const rt = { root: '/p', state: { slots: [{ compiled: [{ board }] }] }, current: () => ({ run: 1 }), compiledOnce: async () => {} }
  const tools = viewerTools({ shared: {}, sources: {}, runtimes: () => [rt], runtimeOfClient: () => rt, viewersOf: () => [viewer], lsp: () => null })
  const accepted = tools.views['session/select']({ board: 'B', selection }, viewer)
  assert.equal(accepted.isolate.ref, 'TP1')
  assert.equal(accepted.level, 'TP1')
  assert.deepEqual(events.at(-1).selection, accepted)
  await assert.rejects(tools.views['session/select']({ board: 'B', selection: { ...selection, isolate: { ...selection.isolate, mode: 'library' } } }, viewer), /no layout/)
})
