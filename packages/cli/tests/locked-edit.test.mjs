import { test } from 'node:test'
import assert from 'node:assert/strict'
import { editTxns, toolsOf } from '../dist/session/edit.js'

function session(initial = '<R1 at="1 2" />') {
  const file = '/tmp/pcbjs-lock-test/pcb.tsx'
  const node = { ref: 'R1', caps: ['placed', 'layered'], at: [1, 2, 0], side: 'F', m: [1, 0, 0, 1, 0, 0], grid: null, src: { at: { file, line: 1, col: 1 } } }
  const board = { name: 'Locks', edit: [node], schematic: { circuits: [] }, items: [], footprints: [{ ref: 'R1' }], groups: [], grids: [] }
  let text = initial
  let writes = 0
  const tx = editTxns({
    root: '/tmp/pcbjs-lock-test',
    board: () => board,
    entry: () => file,
    run: () => 1,
    read: () => ({ text, authority: 'disk', version: null, holder: null, named: file }),
    lsp: () => import('@pcbjs/lsp'),
    write: async files => {
      writes++
      const { textDoc } = await import('@pcbjs/lsp')
      text = textDoc(text).apply(files.flatMap(f => f.edits))
      return [{ file, applied: true, via: 'disk' }]
    },
    assist: () => ({ board: 'Locks', ref: 'R1', command: 'at', typed: [], open: true }),
  })
  const begin = (tool = 'move', refs = ['R1']) => tx.begin({ board: 'Locks', anchor: 'R1', tool, refs }, null)
  return {
    node,
    board,
    tx,
    begin,
    writes: () => writes,
    text: () => text,
    setText: value => {
      text = value
    },
  }
}

test('toolbar locks add and remove bare attributes without rewriting pose; schematic uses its own source', async () => {
  const s = session()
  const query = { board: 'Locks', ref: 'R1' }
  assert.deepEqual(await s.tx.lockState(query), { locked: false, reason: null })
  for (const locked of [true, false]) {
    const t = s.begin('lock')
    await s.tx.update({ txn: t.txn, locked })
    await s.tx.commit({ txn: t.txn })
    assert.equal(s.text(), locked ? '<R1 at="1 2" locked />' : '<R1 at="1 2" />')
    assert.equal((await s.tx.lockState(query)).locked, locked)
    s.node.locked = locked
  }
  s.setText('<R1 at="1 2" />\n<R1 locked />')
  s.board.schematic.drawing = { symbols: [{ ref: 'R1', locked: true, src: { ...s.node.src.at, line: 2 } }] }
  const t = s.tx.begin({ board: 'Locks', anchor: 'R1', refs: ['R1'], tool: 'lock', view: 'sch' }, null)
  await s.tx.update({ txn: t.txn, locked: false })
  await s.tx.commit({ txn: t.txn })
  assert.equal(s.text(), '<R1 at="1 2" />\n<R1 />')
})

test('expression locks cannot be overridden even when false or changed after a plan', async () => {
  for (const value of ['true', 'false', 'enabled']) {
    const s = session(`<R1 locked={${value}} />`)
    assert.match((await s.tx.lockState({ board: 'Locks', ref: 'R1' })).reason, /expression/)
    const t = s.begin('lock')
    await assert.rejects(s.tx.update({ txn: t.txn, locked: false }), /expression/)
    assert.equal(s.writes(), 0)
  }
  const s = session('<R1 locked />'),
    t = s.begin('lock')
  await s.tx.update({ txn: t.txn, locked: false })
  s.setText('<R1 locked={enabled} />')
  await assert.rejects(s.tx.commit({ txn: t.txn }), /expression/)
  assert.equal(s.writes(), 0)
})

test('server rejects locked anchors, group nodes and locked members of a mixed selection', () => {
  const s = session()
  s.node.locked = true
  assert.deepEqual(toolsOf(s.node), [])
  for (const tool of ['move', 'rotate', 'layer', 'assist']) assert.throws(() => s.begin(tool), /locked/)
  const free = { ...s.node, ref: 'R2', locked: false }
  s.board.edit.push(free)
  assert.throws(() => s.tx.begin({ board: 'Locks', anchor: 'R2', refs: ['R2', 'R1'], tool: 'move' }, null), /R1.*locked/)
  s.node.ref = 'Group'
  assert.throws(() => s.tx.begin({ board: 'Locks', anchor: 'Group', refs: ['Group'], tool: 'rotate' }, null), /Group.*locked/)
  assert.equal(s.writes(), 0)
})

test('lock changes are checked on update and again at commit; false restores editing', async () => {
  const s = session()
  const first = s.begin()
  s.node.locked = true
  await assert.rejects(s.tx.update({ txn: first.txn, delta: [1, 0] }), /locked/)
  s.node.locked = false
  const plan = await s.tx.update({ txn: first.txn, delta: [1, 0] })
  assert.equal(plan.files.length, 1)
  s.node.locked = true
  await assert.rejects(s.tx.commit({ txn: first.txn }), /locked/)
  assert.equal(s.writes(), 0)
  s.node.locked = false
  assert.ok(toolsOf(s.node).some(t => t.id === 'move'))
  const next = s.begin()
  await s.tx.update({ txn: next.txn, grid: 0.5 })
  await s.tx.commit({ txn: next.txn })
  assert.equal(s.writes(), 1)
})

test('an assist begun before locking cannot update or commit afterward', async () => {
  const s = session()
  const a = s.begin('assist')
  s.node.locked = true
  await assert.rejects(s.tx.update({ txn: a.txn, point: { at: [3, 4] } }), /locked/)
  assert.equal(s.writes(), 0)
})
