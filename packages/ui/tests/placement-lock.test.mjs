import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { fixture } from './fixture-board.mjs'

registerHooks({
  resolve(spec, ctx, next) {
    try {
      return next(spec, ctx)
    } catch (error) {
      if (spec.startsWith('.') && !spec.endsWith('.ts')) return next(spec + '.ts', ctx)
      throw error
    }
  },
})
const { effectScope, reactive, nextTick } = await import('vue')
const { usePlacementLock } = await import('../src/use/placement-lock.ts')
const { createViewer } = await import('../src/shell.ts')
const { facetSet } = await import('@pcbjs/core/site-facets')
const tick = async () => {
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 0))
}

function setup(query = async () => ({ locked: false, reason: null })) {
  const b = fixture()
  b.dev = { snapshot: 's1' }
  const store = createViewer({ boards: [facetSet(b)], single: true, path: '/', baseUrl: '/' }).board(b.name)
  const calls = []
  store.edit.client = {
    lockState: p => query(p),
    begin: async p => {
      calls.push(['begin', p])
      return { txn: 'lock1' }
    },
    update: async (id, p) => {
      calls.push(['update', p])
      return { files: [], notes: [] }
    },
    commit: async () => {
      calls.push(['commit'])
      return { written: [{ applied: true, file: 'pcb.tsx', via: 'editor' }] }
    },
    cancel: async () => {
      calls.push(['cancel'])
    },
  }
  store.edit.mode = { mode: 'rw', editor: true }
  store.selectRef('R1')
  const pane = reactive({ mode: '2d' })
  const scope = effectScope()
  const lock = scope.run(() => usePlacementLock({ board: store, pane }))
  return { lock, store, pane, calls, stop: () => scope.stop() }
}

test('toolbar locks the focused placement and uses the schematic scope independently', async t => {
  const s = setup(async p => ({ locked: p.view === 'sch', reason: null }))
  t.after(s.stop)
  await tick()
  assert.equal(s.lock.visible.value, true)
  assert.equal(s.lock.reason.value, null)
  await s.lock.toggle()
  assert.equal(s.calls[0][1].tool, 'lock')
  assert.deepEqual(s.calls[0][1].refs, ['R1'])
  assert.deepEqual(s.calls[1], ['update', { locked: true }])
  assert.equal(s.calls[0][1].view, 'pcb')
  s.pane.mode = 'sch'
  await tick()
  assert.equal(s.lock.locked.value, true)
  await s.lock.toggle()
  assert.equal(s.calls[3][1].view, 'sch')
  assert.deepEqual(s.calls[4], ['update', { locked: false }])
})

test('expression locks disable both states, and readonly views cannot toggle', async t => {
  const reason = 'Lock state is derived from an expression and cannot be overridden.'
  for (const locked of [true, false]) {
    const s = setup(async () => ({ locked, reason }))
    t.after(s.stop)
    await tick()
    assert.equal(s.lock.reason.value, reason)
    await s.lock.toggle()
    assert.deepEqual(s.calls, [])
  }
  const s = setup()
  t.after(s.stop)
  await tick()
  s.store.edit.mode = { mode: 'ro', editor: false }
  assert.match(s.lock.reason.value, /read-only/)
  await s.lock.toggle()
  assert.deepEqual(s.calls, [])
})

test('late source checks cannot replace the newly focused part lock state', async t => {
  let first
  const s = setup(p =>
    p.ref === 'R1'
      ? new Promise(resolve => {
          first = resolve
        })
      : Promise.resolve({ locked: true, reason: null }),
  )
  t.after(s.stop)
  await tick()
  s.store.selectRef('R2')
  await tick()
  assert.equal(s.lock.locked.value, true)
  first({ locked: false, reason: null })
  await tick()
  assert.equal(s.lock.locked.value, true)
})

test('changing focus while a lock transaction begins keeps the original requested value', async t => {
  const s = setup(async p => ({ locked: p.ref === 'R2', reason: null }))
  t.after(s.stop)
  await tick()
  let begin
  s.store.edit.client.begin = () =>
    new Promise(resolve => {
      begin = resolve
    })
  const toggled = s.lock.toggle()
  s.store.selectRef('R2')
  await tick()
  begin({ txn: 'lock1' })
  await toggled
  assert.deepEqual(s.calls[0], ['update', { locked: true }])
  assert.equal(s.lock.locked.value, true)
})
