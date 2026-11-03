import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { facetSet, facetsOf } from '@pcbjs/core/site-facets'
import { fixture } from './fixture-board.mjs'

registerHooks({ resolve: (spec, ctx, next) => {
  try { return next(spec, ctx) } catch (error) {
    if (spec.startsWith('.') && !spec.endsWith('.ts')) return next(spec + '.ts', ctx)
    throw error
  }
} })
const { createViewer } = await import('../src/shell.ts')
const { createPane, mountedViews } = await import('../src/pane.ts')
const { parseViewQuery } = await import('../src/query.ts')
const { createSync } = await import('../src/sync.ts')
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
const page = (extra = {}) => createViewer({ boards: [facetSet(fixture())], single: true, path: '/', baseUrl: '/', ...extra })

test('checks has its own facet demand without loading 3D shapes or model meshes', () => {
  assert.deepEqual(facetsOf('checks'), ['meta', 'findings'])
  assert.deepEqual(facetsOf('sch'), ['meta', 'sch', 'findings'])
  assert.deepEqual(mountedViews(createPane('checks')), ['checks'])
  const fixed = createPane('checks', 'checks')
  fixed.mode = '3d'
  assert.equal(fixed.mode, 'checks')
})

test('a browser checks tab persists while canonical focus changes, and remote focus does not switch drawing views', async () => {
  const shell = page()
  shell.applyViewQuery(parseViewQuery('?view=checks'))
  await tick()
  const store = shell.board('Fx')
  assert.equal(shell.pane('Fx').mode, 'checks')
  store.focusFinding(store.site.drc[0])
  await tick()
  assert.equal(shell.pane('Fx').mode, 'checks')
  assert.equal(store.sel.finding, store.site.drc[0].id)
  assert.ok(shell.observing().facets.includes('findings'))
  shell.pane('Fx').mode = '2d'
  store.takeSel({ ...store.sel, finding: store.site.drc[0].id, seq: 9, by: 'sync' })
  await tick()
  assert.equal(shell.pane('Fx').mode, '2d')
  shell.stop()
})

test('an IDE checks pane observes findings even before a finding is selected and panel=0', async () => {
  const shell = page({ ide: true, ideSearch: '?ide=1&view=checks&panel=0' })
  assert.equal(shell.pane('Fx').mode, 'checks')
  assert.ok(shell.observing().facets.includes('findings'))
  shell.applyRequest({ kind: 'view', board: null, target: null, view: '2d', side: null, mirror: null })
  await tick()
  assert.equal(shell.pane('Fx').mode, 'checks', 'the fourth dedicated pane remains fixed')
  shell.stop()
})

test('canonical finding-only changes relay without a second selection store', () => {
  const shell = page()
  const store = shell.board('Fx')
  const sent = []
  const sync = createSync({ select: frame => sent.push(frame), hover() {} }, f => f())
  sync.select('Fx', store.sel, 'checks')
  sync.select('Fx', { ...store.sel, finding: store.site.drc[0].id }, 'checks')
  assert.equal(sent.length, 2)
  assert.equal(sent[1].view, 'checks')
  assert.equal(sent[1].selection.finding, store.site.drc[0].id)
  shell.stop()
})

test('the fourth editor viewer has dedicated beside and new-pane shortcuts', async () => {
  const { vscodeKeybindings } = await import('../src/keys.ts')
  const bindings = vscodeKeybindings()
  assert.deepEqual(bindings.find(x => x.command === 'pcbjs.openChecksBeside'), { command: 'pcbjs.openChecksBeside', key: 'ctrl+alt+4', mac: 'cmd+alt+4', when: 'pcbjs.active' })
  assert.deepEqual(bindings.find(x => x.command === 'pcbjs.openChecksNew'), { command: 'pcbjs.openChecksNew', key: 'ctrl+alt+shift+4', mac: 'cmd+alt+shift+4', when: 'pcbjs.active' })
})
