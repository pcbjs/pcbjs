// A drag keeps one update in flight, replaces waiting updates with the newest and commits after the final reply.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dragTxn } from '../src/edit-client.ts'

function controlled() {
  const log = [],
    pending = []
  let open = 0,
    most = 0
  const request = (method, value, delta) => {
    log.push(delta ? `update ${delta.join(' ')}` : method)
    most = Math.max(most, ++open)
    return new Promise(resolve =>
      pending.push({
        method,
        answer() {
          open--
          resolve(value)
        },
      }),
    )
  }
  return {
    log,
    most: () => most,
    reply(method) {
      const next = pending.shift()
      assert.equal(next?.method, method, 'reply to the expected outstanding request')
      next.answer()
    },
    begin: () => request('begin', { txn: 't1', tools: [] }),
    update: (txn, u) => request('update', { delta: u.delta }, u.delta),
    commit: () => request('commit', { ok: true }),
    cancel: () => request('cancel', null),
  }
}
const turn = () => new Promise(resolve => setImmediate(resolve))
const begin = { board: 'B', tool: 'move', refs: ['R1'], anchor: 'R1' }

test('a drag coalesces waiting updates, sends them serially and commits only after the final reply', async () => {
  const c = controlled(),
    plans = []
  const d = dragTxn(c, begin, p => plans.push(p.delta[0]))
  d.update({ delta: [1, 0] })
  c.reply('begin')
  await turn()
  assert.deepEqual(c.log, ['begin', 'update 1 0'])

  for (let x = 2; x <= 10; x++) d.update({ delta: [x, 0] })
  const committed = d.commit()
  d.update({ delta: [11, 0] })
  await turn()
  assert.deepEqual(c.log, ['begin', 'update 1 0'], 'pending moves and commit wait for the first reply')

  c.reply('update')
  await turn()
  assert.deepEqual(c.log, ['begin', 'update 1 0', 'update 10 0'], 'only the newest waiting move is sent')
  assert.deepEqual(plans, [1])
  c.reply('update')
  await turn()
  assert.deepEqual(plans, [1, 10])
  assert.deepEqual(c.log, ['begin', 'update 1 0', 'update 10 0', 'commit'])
  c.reply('commit')
  await committed
  assert.equal(c.most(), 1, 'begin, updates and commit never overlap')
})

test('duplicate updates send once and cancel suppresses waiting and later moves', async () => {
  const c = controlled(),
    plans = []
  const d = dragTxn(c, begin, p => plans.push(p.delta[0]))
  c.reply('begin')
  await d.started
  d.update({ delta: [1, 0] })
  d.update({ delta: [1, 0] })
  await turn()
  assert.deepEqual(c.log, ['begin', 'update 1 0'])
  c.reply('update')
  await turn()
  d.update({ delta: [1, 0] })
  await turn()
  assert.deepEqual(c.log, ['begin', 'update 1 0'], 'a repeated value after its reply is still deduplicated')

  d.update({ delta: [2, 0] })
  await turn()
  d.update({ delta: [3, 0] })
  const canceled = d.cancel()
  d.update({ delta: [4, 0] })
  await turn()
  assert.deepEqual(c.log, ['begin', 'update 1 0', 'update 2 0', 'cancel'])
  c.reply('update')
  await turn()
  assert.deepEqual(plans, [1, 2])
  assert.deepEqual(c.log, ['begin', 'update 1 0', 'update 2 0', 'cancel'], 'finishing the in-flight update cannot send the dropped pending move')
  c.reply('cancel')
  await canceled
})
