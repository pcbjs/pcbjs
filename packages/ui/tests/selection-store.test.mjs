// Each board's store holds its selection: a click, Escape and Isolate change it, the URL carries it into another page and
// `pcbjs:select` carries it to another viewer, which shows the same members, anchor, level and isolation.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { fixture } from './fixture-board.mjs'
import { facetSet } from '@pcbjs/core/site-facets'

registerHooks({
  resolve: (spec, ctx, next) => {
    try {
      return next(spec, ctx)
    } catch (e) {
      if (spec.startsWith('.') && !spec.endsWith('.ts')) return next(spec + '.ts', ctx)
      throw e
    }
  },
})
const { createViewer } = await import('../src/shell.ts')
const { parseViewQuery, selectSearch } = await import('../src/query.ts')
const { createSync } = await import('../src/sync.ts')
const { sameSelection } = await import('@pcbjs/core/internal/selection')

const tick = () => new Promise(r => setTimeout(r, 0))
const page = (search = '') => {
  const store = createViewer({ boards: [facetSet(fixture())], single: true, path: '/', baseUrl: '/' })
  if (search) store.applyViewQuery(parseViewQuery(search))
  return store
}
const pad = (id, ref, net) => ({ kind: 'pad', id, ref, net })

test('a click, shift and Isolate in one page; its URL opens a page with the same selection', async () => {
  const a = page()
  assert.equal(a.current.value.name, 'Fx')
  const b = a.board('Fx')
  b.pick(pad(5, 'R101', 'S1'), { shift: false, deep: false })
  b.pick(pad(1, 'R1', 'A'), { shift: true, deep: false })
  const v = b
  assert.deepEqual([v.sel.refs, v.sel.anchor, v.sel.by], [['CH1', 'G'], 'G', 'viewer'])
  b.escapeSel()
  assert.deepEqual(v.sel.refs, [], 'Escape at the root clears')
  b.pick(pad(5, 'R101', 'S1'), { shift: false, deep: false })
  b.pick(pad(1, 'R1', 'A'), { shift: true, deep: false })
  b.toggleIsolate()
  if (b.sel.isolateChoice) b.chooseIsolation('library')
  assert.equal(v.sel.isolate?.ref, 'G')
  assert.deepEqual(b.frame?.box?.length, 4, 'the views frame what the isolation shows')
  b.toggleIsolate()
  if (b.sel.isolateChoice) b.chooseIsolation('library')
  assert.equal(v.sel.isolate, null)
  b.pick(pad(5, 'R101', 'S1'), { shift: false, deep: true })
  b.pick(pad(1, 'R1', 'A'), { shift: true, deep: false })
  const search = selectSearch('', b.selection(), null)
  assert.equal(search, '?select=G,CH1/R01/1')
  const c = page(search)
  await tick()
  const w = c.board('Fx')
  assert.deepEqual([w.sel.anchor, new Set(w.sel.refs), w.sel.isolate, w.sel.by], ['G', new Set(['G', 'CH1/R01/1']), null, 'url'])
  // inside an isolation: the page opens isolated with the member selected in it
  b.pick(pad(5, 'R101', 'S1'), { shift: false, deep: false })
  b.toggleIsolate()
  if (b.sel.isolateChoice) b.chooseIsolation('library')
  b.pick(pad(5, 'R101', 'S1'), { shift: false, deep: true })
  const iso = selectSearch('', b.selection(), v.sel.isolate.ref)
  assert.equal(iso, '?select=CH1/R01/1&isolate=CH1')
  const d = page(iso)
  await tick()
  const x = d.board('Fx').sel
  assert.deepEqual([x.refs, x.level, x.isolate?.ref, x.isolate?.instances], [['CH1/R01/1'], 'CH1', 'CH1', ['CH1', 'CH2']])
  a.stop()
  c.stop()
  d.stop()
})

test('pcbjs:select carries a selection to another viewer, which takes it whole and sends nothing back', async () => {
  const a = page(),
    c = page()
  const sent = []
  const one = createSync({ select: data => sent.push({ method: 'session/select', data }), hover() {} }, cb => cb())
  const two = createSync({ select: data => sent.push({ method: 'session/select', data, from: 2 }), hover() {} }, cb => cb())
  const b = a.board('Fx')
  b.pick({ kind: 'track', id: 9, net: 'S1' }, { shift: false, deep: true })
  b.toggleIsolate()
  if (b.sel.isolateChoice) b.chooseIsolation('library')
  b.pick(pad(5, 'R101', 'S1'), { shift: false, deep: false })
  one.select('Fx', b.sel)
  assert.equal(sent.length, 1)
  const msg = sent[0].data
  assert.equal(sent[0].method, 'session/select')
  // the session stamps the seq and sends it to every viewer of the board
  const relayed = { board: msg.board, selection: { ...msg.selection, seq: 3 } }
  c.board('Fx').takeSel(two.receive(relayed))
  const got = c.board('Fx').sel
  assert.ok(sameSelection(got, b.sel))
  assert.deepEqual([got.level, got.isolate?.ref, got.refs], ['CH1', 'CH1', ['CH1/R01']])
  two.select('Fx', got)
  assert.equal(sent.length, 1, 'the received selection is not sent back')
  a.stop()
  c.stop()
})

test('canonical finding focus clears on empty canvas, Escape and removing its last chip', () => {
  const p = page()
  const b = p.board('Fx')
  const finding = { id: 'drc:test:empty', fingerprint: 'test', rule: 'test', message: 'test', severity: 'error', refs: [], at: [1, 2] }
  b.site.drc.push(finding)
  for (const clear of [() => b.pick(null, { shift: false, deep: false }), () => b.escapeSel(), () => b.dropMember(finding.id)]) {
    b.focusFinding(finding)
    assert.equal(b.sel.finding, finding.id)
    clear()
    assert.equal(b.sel.finding, null)
    assert.equal(b.finding, null)
  }
  p.stop()
})

test('area frames clear with their selection and remote isolation uses the same framing lifecycle', async () => {
  const p = page(), remote = page()
  const b = p.board('Fx'), r = remote.board('Fx')
  b.selectRef('net:B', true)
  assert.ok(b.frame?.box)
  b.selectRef(null)
  assert.equal(b.frame, null, 'area focus must end with its owning selection')
  b.isolateRef('CH1')
  assert.ok(b.frame?.box)
  r.takeSel({ ...b.sel })
  assert.deepEqual(r.frame, b.frame, 'remote isolation fits just like local isolation')
  const finding = { id: 'drc:test:nested', rule: 'test', message: 'test', severity: 'error', refs: [], at: [1, 2] }
  b.site.drc.push(finding)
  b.focusFinding(finding)
  const frame = b.frame
  b.escapeSel()
  assert.equal(b.sel.finding, null)
  assert.equal(b.sel.isolate?.ref, 'CH1', 'first Escape cancels the nested finding')
  assert.equal(b.frame, frame)
  b.toggleIsolate()
  assert.equal(b.sel.isolate, null)
  assert.equal(b.frame, null, 'exit requests rollback rather than fitting a new area')
  r.takeSel({ ...b.sel })
  assert.equal(r.frame, null)
  await tick()
  p.stop(); remote.stop()
})

test('pane focus cancellation queues rollback for hidden views and keeps a new explicit request', async () => {
  const { focusTransaction } = await import('../src/focus-transaction.ts')
  const { focusAt } = await import('../src/pane.ts')
  const p = page(), b = p.board('Fx'), pane = p.pane('Fx')
  const tx = focusTransaction(pane.focusViews, 'Fx', '2d')
  b.selectRef('G')
  pane.focus = focusAt([1, 2], 4, false)
  await tick()
  assert.ok(pane.focus, 'the request made with a new selection survives its watcher')
  tx.begin('frame', [0, 0, 100, 100])
  b.selectRef(null)
  await tick()
  assert.equal(pane.focus, null)
  assert.deepEqual(tx.takeRestore(), [0, 0, 100, 100])
  p.stop()
})

test('same-ID finding updates keep stable focus requests and cancel inapplicable views', async () => {
  const p = page(), b = p.board('Fx'), pane = p.pane('Fx')
  b.site.schematic.drawing = { grid: 1, symbols: [{ ref: 'R1', box: [0, 0, 2, 4] }] }
  const finding = { id: 'drc:test:stable', fingerprint: 'stable', rule: 'test', message: 'test', severity: 'error', refs: ['R1'], at: [1, 2] }
  b.site.drc.push(finding)
  b.focusFinding(finding)
  await tick()
  const first = pane.focus
  assert.ok(first)
  assert.equal(pane.schFocus, null, 'PCB finding points do not focus an unmarked schematic')
  b.targets = [{ ...b.site }]
  await tick()
  assert.equal(pane.focus, first, 'unrelated facet updates do not refit')
  b.targets = [{ ...b.site, drc: [], erc: [{ ...finding, layer: 'sch', at: [8, 9] }] }]
  await tick()
  assert.equal(pane.focus, null, 'a schematic-only finding cancels board camera focus')
  assert.deepEqual(pane.schFocus?.at, [8, 9])
  const sch = pane.schFocus
  pane.mode = 'sch'
  await tick()
  pane.mode = '3d'
  await tick()
  assert.equal(pane.schFocus, sch, 'hiding a view retains its active request for remount')
  b.selectRef(null)
  await tick()
  assert.equal(pane.schFocus, null)
  p.stop()
})

test('a point-only focus remains active until an explicit empty selection cancels it', async () => {
  const { focusTransaction } = await import('../src/focus-transaction.ts')
  const { focusAt } = await import('../src/pane.ts')
  const p = page(), b = p.board('Fx'), pane = p.pane('Fx')
  const tx = focusTransaction(pane.focusViews, 'Fx', '2d')
  pane.focus = focusAt([3, 4], 2, true)
  await tick()
  tx.begin('frame', [0, 0, 100, 100])
  assert.ok(pane.focus)
  b.selectRef(null)
  await tick()
  assert.equal(pane.focus, null)
  assert.deepEqual(tx.takeRestore(), [0, 0, 100, 100])
  p.stop()
})

test('target-only and snapshot-only changes relay once and remote target replay has no echo', () => {
  const p = page(), b = p.board('Fx'), sent = []
  const sync = createSync({ select: m => sent.push(m), hover() {} }, cb => cb())
  sync.select('Fx', b.sel)
  b.target = 'other'
  assert.equal(b.sel.target, 'other')
  sync.select('Fx', b.sel)
  sync.select('Fx', { ...b.sel, snapshot: 's.2' })
  assert.equal(sent.length, 3)
  b.takeSel(sync.receive({ board: 'Fx', selection: { ...b.sel, target: null, snapshot: 's.3', seq: 4 } }))
  assert.equal(b.target, null)
  sync.select('Fx', b.sel)
  assert.equal(sent.length, 3)
  p.stop()
})

test('group focus offers layout editing and a second click enters instance layout immediately', () => {
  const p = page(), b = p.board('Fx'), hit = pad(5, 'R101', 'S1')
  b.pick(hit, { shift: false, deep: false })
  assert.equal(b.sel.anchor, 'CH1')
  assert.equal(b.sel.isolate, null)
  b.chooseIsolation('instance')
  assert.equal(b.sel.isolate.mode, 'instance')
  assert.equal(b.sel.isolate.ref, 'CH1')
  assert.equal(b.iso.fade, true, 'instance layout retains board context')
  assert.equal(b.iso.frame, null, 'instance layout stays in board coordinates')
  b.escapeSel()
  b.pick(hit, { shift: false, deep: false })
  assert.equal(b.sel.isolate.mode, 'instance')
  assert.equal(b.sel.isolateChoice ?? null, null, 'no delayed choice dialog')
  b.chooseIsolation('library')
  assert.equal(b.sel.isolate.mode, 'library')
  assert.equal(b.iso.fade, false, 'library layout hides placed board and other copies')
  assert.ok(b.iso.frame, 'library layout has a local coordinate frame')
  assert.deepEqual([...b.iso.parts], ['R101'])
  p.stop()
})

test('lazy library geometry is target-aware and ignores replies after leaving or changing snapshots', async () => {
  const { effectScope } = await import('vue')
  const { connectLibrary } = await import('../src/layout.ts')
  const p = page(), b = p.board('Fx'), pending = []
  const scope = effectScope()
  scope.run(() => connectLibrary({ request(method, params) { return new Promise(resolve => pending.push({ method, params, resolve })) } }, () => b))
  b.pick(pad(5, 'R101', 'S1'), { shift: false, deep: false })
  b.chooseIsolation('library')
  await tick()
  assert.equal(pending.length, 1)
  assert.deepEqual(pending[0].params, { board: 'Fx', target: null, ref: 'CH1' })
  b.chooseIsolation('instance')
  await tick()
  pending[0].resolve(fixture())
  await tick()
  assert.equal(b.library, null)
  b.run = 2
  b.chooseIsolation('library')
  await tick()
  b.run = 3
  await tick()
  pending[1].resolve(fixture())
  await tick()
  assert.equal(b.library, null, 'old snapshot response is not rendered')
  pending[2].resolve(fixture())
  await tick()
  assert.equal(b.library.run, 3)
  assert.equal(b.sel.isolate.mode, 'library')
  assert.equal(b.sel.isolate.ref, 'CH1', 'geometry loading never rewrites canonical focus')
  scope.stop()
  p.stop()
})

test('library geometry applies to all drawing panes while checks retain the full canonical board', async () => {
  const { useActions } = await import('../src/use/actions.ts')
  const p = page(), b = p.board('Fx'), base = b.site
  b.pick(pad(5, 'R101', 'S1'), { shift: false, deep: false })
  b.chooseIsolation('library')
  const local = { ...base, footprints: base.footprints.filter(f => f.ref === 'R101'), drc: [], erc: [] }
  b.library = { ref: 'CH1', target: null, run: b.run, site: local }
  const ctx = p.context('Fx'), action = useActions(ctx)
  assert.equal(b.site.footprints.length, base.footprints.length)
  assert.equal(action.site.value.footprints.length, 1)
  ctx.pane.mode = 'sch'
  assert.equal(action.site.value.footprints.length, 1)
  assert.equal(action.site.value.drc.length, 0)
  ctx.pane.mode = 'checks'
  assert.equal(action.site.value, b.site)
  p.stop()
})

test('library errors stay readable and retry without changing canonical mode', async () => {
  const { effectScope } = await import('vue')
  const { connectLibrary } = await import('../src/layout.ts')
  const p = page(), b = p.board('Fx'), pending = [], scope = effectScope()
  scope.run(() => connectLibrary({ request() { return new Promise((resolve, reject) => pending.push({ resolve, reject })) } }, () => b))
  b.pick(pad(5, 'R101', 'S1'), { shift: false, deep: false })
  b.chooseIsolation('library')
  await tick()
  assert.equal(b.libraryState, 'loading')
  b.edit.client = {}
  assert.equal(b.layoutSite, null, 'live library loading never flashes board instance numbering')
  pending[0].reject(new Error('Library compile failed'))
  await tick()
  assert.equal(b.libraryState, 'error')
  assert.equal(b.libraryError, 'Library compile failed')
  assert.equal(b.sel.isolate.mode, 'library')
  b.libraryN++
  await tick()
  assert.equal(b.libraryState, 'loading')
  pending[1].resolve(fixture())
  await tick()
  assert.equal(b.libraryState, 'ready')
  assert.equal(b.libraryError, null)
  scope.stop()
  p.stop()
})

test('standalone schematic actions use library geometry and preserve canonical selections', async () => {
  const { useActions } = await import('../src/use/actions.ts')
  const p = page(), b = p.board('Fx'), base = b.site
  b.pick(pad(5, 'R101', 'S1'), { shift: false, deep: false })
  b.chooseIsolation('library')
  b.library = { ref: 'CH1', target: null, run: b.run, site: { ...base, footprints: base.footprints.filter(f => f.ref === 'R101'), drc: [], erc: [] } }
  const ctx = p.context('Fx')
  ctx.pane.mode = '2d'
  const schematic = useActions(ctx, 'sch'), pcb = useActions(ctx, '2d')
  assert.equal(schematic.site.value, pcb.site.value)
  assert.equal(pcb.site.value.footprints.length, 1)
  schematic.onPick(pad(5, 'R101', 'S1'), { shift: false, deep: true })
  assert.equal(b.sel.anchor, 'CH1/R01/1', 'schematic uses canonical source identity inside the library layout')
  assert.equal(b.sel.isolate.ref, 'CH1', 'schematic leaves canonical PCB isolation intact')
  p.stop()
})

test('standalone schematic facet demand fetches library geometry', async () => {
  const { effectScope } = await import('vue')
  const { connectLibrary } = await import('../src/layout.ts')
  const p = page(), b = p.board('Fx'), calls = [], scope = effectScope()
  scope.run(() => connectLibrary({ request(method, params) { calls.push(params); return Promise.resolve(fixture()) } }, () => b.wanted.has('layers') || b.wanted.has('model') || b.wanted.has('sch') ? b : null))
  b.pick(pad(5, 'R101', 'S1'), { shift: false, deep: false })
  b.chooseIsolation('library')
  b.want(['meta', 'sch', 'findings'])
  await tick()
  assert.equal(calls.length, 1)
  b.want(['layers', 'shapes'])
  await tick()
  assert.equal(calls.length, 1)
  scope.stop()
  p.stop()
})


test('clearing part focus exits instance layout and its framing locally and on remote replay', () => {
  for (const clear of [b => b.pick(null, { shift: false, deep: false }), b => b.selectRef(null, false, 'editor'), b => b.dropMember(b.sel.anchor)]) {
    const p = page(), other = page(), b = p.board('Fx'), remote = other.board('Fx')
    const hit = pad(5, 'R101', 'S1')
    b.pick(hit, { shift: false, deep: false })
    b.pick(hit, { shift: false, deep: false })
    assert.equal(b.sel.isolate.mode, 'instance')
    assert.ok(b.sel.refs.length)
    remote.takeSel({ ...b.sel })
    clear(b)
    assert.deepEqual([b.sel.refs, b.sel.anchor, b.sel.level, b.sel.isolate, b.frame], [[], null, null, null, null])
    remote.takeSel({ ...b.sel })
    assert.deepEqual([remote.sel.isolate, remote.sel.level, remote.frame], [null, null, null])
    p.stop(); other.stop()
  }
})

test('blur keeps library context and a newly entered instance can wait for its first member', () => {
  const p = page(), b = p.board('Fx')
  b.isolateRef('CH1')
  assert.equal(b.sel.isolate.mode, 'instance')
  assert.equal(b.sel.refs.length, 0)
  b.selectRef('CH1/R01')
  b.chooseIsolation('library')
  b.selectRef(null)
  assert.equal(b.sel.isolate.mode, 'library')
  p.stop()
})
