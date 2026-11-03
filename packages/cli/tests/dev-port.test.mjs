// `pcbjs dev --port 0`: Vite reads port 0 as unset, so the session probes a free port itself and holds Vite to it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { freePort } from '../dist/server/listen.js'
import { serveSession } from './fixtures/proc.mjs'

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

test('free port: a session started with -p 0 listens on the port its dev.json names', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pcbjs-port-')))
  const session = await serveSession(root)
  try {
    assert.ok(session.port > 1024, session.info.url)
    assert.equal(await canListen(session.port, '127.0.0.1'), false, 'the session holds the port')
    assert.equal((await fetch(`http://127.0.0.1:${session.port}/__pcbjs/scopes`)).status, 200)
  } finally {
    await session.stop()
    rmSync(root, { recursive: true, force: true })
  }
})
