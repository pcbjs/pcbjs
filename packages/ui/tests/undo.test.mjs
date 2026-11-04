// Native document history stays with the editor; standalone session history changes only after success. Undo is a keyboard command.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { joinSite } from '@pcbjs/core/site-facets'
import * as ui from '../dist/index.js'
import { fixture } from './fixture-board.mjs'

const { pushStep, stepOf, undoStep } = await import('../src/undo.ts')

const commit = (txn, ...written) => ({ txn, written: written.map(([file, via]) => ({ file, via, applied: true })) })

test('outside a pane the session undoes an editor write too; a refused undo keeps its step and says why', async () => {
  const s = { done: [], undone: [] }
  pushStep(s, commit('edit1', ['/p/pcb.tsx', 'editor']))
  const err = await undoStep(s, false, { session: async txn => ({ txn, written: [], error: 'pcb.tsx changed since the edit; nothing was undone' }) })
  assert.match(err, /changed since the edit/)
  assert.equal(s.done.length, 1)
  assert.equal(await undoStep(s, false, { session: async txn => ({ txn, written: [] }) }), null)
  assert.equal(s.undone.length, 1)
})

test('the chip has no undo toolbar even after an edit from this page', async () => {
  const b = joinSite({
    meta: { ...fixture(), copper: 2, thickness: 1.6, viewBox: [0, 0, 30, 30], bbox: { x: 0, y: 0, w: 30, h: 30 }, outline: [], airwires: [], sourcingTags: [] },
  })
  const render = () => renderToString(createSSRApp({ render: () => h(ui.PathChip, { board: b }) }))
  assert.doesNotMatch(await render(), /aria-label="Undo"/)
  pushStep(ui.useBoard(b).edit, commit('edit1', ['/p/pcb.tsx', 'editor']))
  assert.doesNotMatch(await render(), /aria-label="(?:Undo|Redo)"|class="chip act undo"/)
})

test('edit ownership is captured before asynchronous begin and never follows later board/project navigation', async () => {
  const { editClient } = await import('../src/edit-client.ts')
  let resolveBegin
  let project = '/workspace/first'
  const commits = []
  const client = editClient(
    {
      request: (method, p) =>
        method.endsWith('/begin')
          ? new Promise(resolve => {
              resolveBegin = resolve
            })
          : Promise.resolve({ txn: p.txn, written: [{ file: '/workspace/first/source.tsx', via: 'editor', applied: true }] }),
    },
    (result, owner) => commits.push({ result, owner }),
    undefined,
    board => ({ board, project }),
  )
  const pending = client.begin({ board: 'Fx', refs: ['R1'], tool: 'move' })
  project = '/workspace/second'
  resolveBegin({ txn: 'edit1' })
  await pending
  await client.commit('edit1')
  assert.deepEqual(commits[0].owner, { board: 'Fx', project: '/workspace/first' })
})

test('standalone successful undo and redo move session steps; a new commit clears redo', async () => {
  const s = { done: [], undone: [] }
  const calls = []
  const ports = { session: async (txn, redo) => (calls.push({ txn, redo }), { txn, written: [] }) }
  pushStep(s, commit('edit1', ['/p/pcb.tsx', 'disk']))
  pushStep(s, commit('edit2', ['/p/pcb.tsx', 'disk']))
  await undoStep(s, false, ports)
  await undoStep(s, true, ports)
  assert.deepEqual(
    s.done.map(step => step.txn),
    ['edit1', 'edit2'],
  )
  await undoStep(s, false, ports)
  assert.deepEqual(
    s.undone.map(step => step.txn),
    ['edit2'],
  )
  pushStep(s, commit('edit3', ['/p/pcb.tsx', 'disk']))
  assert.deepEqual(s.undone, [])
  assert.equal(undoStep(s, true, ports), false)
  assert.deepEqual(calls, [
    { txn: 'edit2', redo: false },
    { txn: 'edit2', redo: true },
    { txn: 'edit2', redo: false },
  ])
})
