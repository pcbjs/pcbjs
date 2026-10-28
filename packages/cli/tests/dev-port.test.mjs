// `pcbjs dev --port 0`: Vite reads port 0 as unset, so the dev server probes a free port itself and holds Vite to it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { freePort } from '../dist/server.js'

const canListen = (port, host) =>
  new Promise(done => {
    const s = createServer()
    s.once('error', () => done(false))
    s.listen(port, host, () => s.close(() => done(true)))
  })

test('free port: two probes give unprivileged ports that are free to listen on', async () => {
  const a = await freePort('127.0.0.1')
  const b = await freePort('127.0.0.1')
  for (const p of [a, b]) {
    assert.ok(Number.isInteger(p) && p > 1024 && p < 65536, `port ${p}`)
    assert.equal(await canListen(p, '127.0.0.1'), true, `port ${p} is free`)
  }
})

test('free port: a port held by another server is never handed out', async () => {
  const held = createServer()
  await new Promise(d => held.listen(0, '127.0.0.1', d))
  const taken = held.address().port
  try {
    for (let i = 0; i < 5; i++) assert.notEqual(await freePort('127.0.0.1'), taken)
  } finally {
    held.close()
  }
})
