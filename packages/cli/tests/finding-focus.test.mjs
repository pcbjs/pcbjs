import { test } from 'node:test'
import assert from 'node:assert/strict'
import { viewerTools } from '../dist/session/viewers.js'
import { emptySelection } from '@pcbjs/core/internal/selection'

function fixture() {
  const model = {
    name: 'B',
    items: [],
    nets: [],
    footprints: [{ ref: 'R1', pads: [] }],
    schematic: { parts: [], circuits: [{ path: ['CH1'] }, { path: ['CH2'] }] },
    drc: [{ id: 'drc:clearance:0123456789ab', rule: 'clearance', message: 'too close', severity: 'error', refs: ['R1'], at: [3, 4] }],
    erc: [],
  }
  const rt = { root: '/p', state: { slots: [{ compiled: [{ board: model }] }] }, stale: () => false }
  const viewers = [0, 1, 2].map(() => ({
    observe: { board: 'B' },
    by: () => null,
    got: [],
    event(event, data) {
      this.got.push({ event, data })
    },
  }))
  const editor = []
  const h = {
    shared: { clients: { relay: (event, data) => editor.push({ event, data }) } },
    sources: {},
    runtimes: () => [rt],
    runtimeOfClient: () => rt,
    viewersOf: () => viewers,
    lsp: () => null,
  }
  return { tools: viewerTools(h), viewers, editor }
}

test('finding focus is canonical across three views and editor, independent of entity selection, and clears everywhere', () => {
  const { tools, viewers, editor } = fixture()
  const focus = { ...emptySelection('B'), finding: 'drc:clearance:0123456789ab' }
  tools.views['session/select']({ board: 'B', selection: focus }, viewers[0])
  assert.ok(viewers.every(v => v.got.at(-1).data.selection.finding === focus.finding))
  assert.equal(editor.at(-1).data.finding.id, focus.finding)
  tools.views['session/select']({ board: 'B', selection: { ...focus, refs: ['R1'], anchor: 'R1' } }, viewers[1])
  assert.equal(editor.at(-1).data.finding.id, focus.finding)
  tools.views['session/select']({ board: 'B', selection: { ...focus, finding: null } }, viewers[2])
  assert.ok(viewers.every(v => v.got.at(-1).data.selection.finding === null))
  assert.equal(editor.at(-1).data.finding, null)
})

test('pending isolation choice and explicit instance mode propagate to all PCB viewers', () => {
  const { tools, viewers } = fixture()
  const iso = { ref: 'CH1', context: 'CH1', instances: ['CH1', 'CH2'], preview: false }
  const choice = { ...emptySelection('B'), isolateChoice: iso }
  tools.views['session/select']({ board: 'B', selection: choice }, viewers[0])
  assert.ok(viewers.every(v => v.got.at(-1).data.selection.isolateChoice.ref === 'CH1'))
  tools.views['session/select']({ board: 'B', selection: { ...choice, isolateChoice: null, isolate: { ...iso, mode: 'instance' } } }, viewers[1])
  assert.ok(viewers.every(v => v.got.at(-1).data.selection.isolate.mode === 'instance'))
})

test('a viewer cannot establish focus on an unknown named target', () => {
  const { tools, viewers } = fixture()
  assert.throws(
    () => tools.views['session/select']({ board: 'B', selection: { ...emptySelection('B', 'missing'), finding: 'drc:clearance:0123456789ab' } }, viewers[0]),
    /target missing/,
  )
  assert.equal(viewers[0].got.length, 0)
})
