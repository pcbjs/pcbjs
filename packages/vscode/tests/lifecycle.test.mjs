import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { mockSession, until, sleep } from './fake.mjs'

const require = createRequire(import.meta.url)
const { Wiring } = require('../dist/wiring.cjs')
const { SessionLink } = require('../dist/link.cjs')
const { PcbjsServer } = require('../dist/server.cjs')
const { PROTOCOL, MAJOR } = require('@pcbjs/core/protocol')
const ready = {
  port: 5301,
  host: '127.0.0.1',
  urls: ['http://127.0.0.1:5301/'],
  root: '/work/p',
  pid: process.pid,
  version: '0.0.1',
  protocol: PROTOCOL,
  major: MAJOR,
  capabilities: ['lsp'],
  session: 'mock0001',
  mode: 'rw',
  projects: [],
}
const options = s => ({ folders: () => [s.dev.root], devInfo: () => s.dev, backoffMinMs: 5, backoffMaxMs: 10 })
const lsp = dispose => ({ session: {}, peer: { alive: () => true, notify() {} }, dispose })

for (const kind of ['throws', 'hangs'])
  test(`window teardown disconnects even when language disposal ${kind}, once and without reconnecting`, async () => {
    const s = await mockSession(ready)
    let calls = 0
    const w = new Wiring({
      ...options(s),
      docs: () => [],
      language: async () =>
        lsp(() => {
          calls++
          if (kind === 'throws') throw new Error('failed shutdown')
          return new Promise(() => {})
        }),
    })
    try {
      await w.server.start()
      await until(() => w.server.client?.lsp)
      const disposed = w.dispose(20)
      assert.equal(w.dispose(), disposed)
      await disposed
      await until(() => s.connections === 0)
      assert.equal(calls, 1)
      assert.equal(w.server.state.kind, 'detached')
      await w.server.start()
      await sleep(30)
      assert.equal(s.connections, 0, 'late preview callback cannot restart a disposed owner')
      assert.equal(s.frames.filter(f => f.event === 'pcbjs:ide:hello').length, 1)
      assert.ok(!s.frames.some(f => f.method === 'session/stop'), 'ordinary close leaves shared core alive')
    } finally {
      await w.dispose(20)
      await s.close()
    }
  })

test('language initialization resolving after window teardown is disposed without resync', async () => {
  const s = await mockSession(ready)
  let resolveLanguage,
    calls = 0,
    resyncs = 0
  const w = new Wiring({
    ...options(s),
    docs: () => [],
    language: () =>
      new Promise(done => {
        resolveLanguage = done
      }),
    onResync: () => resyncs++,
  })
  try {
    await w.server.start()
    await until(() => resolveLanguage)
    await w.dispose()
    resolveLanguage(
      lsp(async () => {
        calls++
      }),
    )
    await until(() => calls === 1)
    assert.equal(resyncs, 0)
    assert.equal(w.server.links.length, 0)
    await until(() => s.connections === 0)
  } finally {
    await w.dispose()
    await s.close()
  }
})

test('closing during hello aborts the in-flight transport immediately', async () => {
  const s = await mockSession(null)
  const server = new PcbjsServer(options(s))
  try {
    const starting = server.start()
    await until(() => s.connections === 1)
    await server.dispose()
    await starting
    await until(() => s.connections === 0)
    assert.equal(server.state.kind, 'detached')
    assert.equal(server.links.length, 0)
  } finally {
    await server.dispose()
    await s.close()
  }
})

test('hello timeout closes its socket and a pre-aborted connection never opens one', async () => {
  const s = await mockSession(null)
  try {
    await assert.rejects(SessionLink.connect(s.dev, { name: 'test', version: 'dev', timeoutMs: 25 }), /did not answer hello/)
    await until(() => s.connections === 0)
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(SessionLink.connect(s.dev, { name: 'test', version: 'dev', signal: controller.signal }), /cancelled/)
    assert.equal(s.connections, 0)
  } finally {
    await s.close()
  }
})

test('repeated reload and close/reopen cycles attach one new window owner to the surviving session', async () => {
  const s = await mockSession(ready)
  try {
    for (let i = 0; i < 4; i++) {
      const w = new Wiring({ ...options(s), docs: () => [], language: async () => lsp(async () => {}) })
      try {
        await w.server.start()
        await until(() => w.server.client?.lsp)
        assert.equal(s.connections, 1)
        assert.equal(w.server.client.session, ready.session)
      } finally {
        await w.dispose()
      }
      await until(() => s.connections === 0)
    }
    assert.equal(s.frames.filter(f => f.event === 'pcbjs:ide:hello').length, 4)
  } finally {
    await s.close()
  }
})

test('OS-killed editor process releases its connection without deactivation; a reopened window attaches', async () => {
  const s = await mockSession(ready)
  const child = spawn(
    process.execPath,
    [
      '-e',
      `const {SessionLink}=require(${JSON.stringify(require.resolve('../dist/link.cjs'))}); SessionLink.connect(${JSON.stringify(s.dev)},{name:'killed-window',version:'dev'}).then(()=>process.stdout.write('ready\\n'))`,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
  const exit = new Promise(done => child.once('exit', done))
  try {
    await until(() => s.connections === 1)
    child.kill('SIGKILL')
    await exit
    await until(() => s.connections === 0)
    const w = new Wiring({ ...options(s), docs: () => [], language: async () => lsp(async () => {}) })
    try {
      await w.server.start()
      await until(() => w.server.client?.lsp)
      assert.equal(w.server.state.kind, 'running')
      assert.equal(s.connections, 1)
    } finally {
      await w.dispose()
    }
  } finally {
    child.kill('SIGKILL')
    await exit
    await s.close()
  }
})

test('window teardown settles scope and readiness waits, including requests made after disposal', async () => {
  const s = await mockSession(ready)
  const server = new PcbjsServer(options(s))
  try {
    const scope = server.whenScope(() => false)
    const readiness = assert.rejects(server.whenReady(), /detached/)
    await server.dispose()
    assert.equal(await scope, undefined)
    await readiness
    assert.equal(await server.whenScope(() => true), undefined)
    await assert.rejects(server.whenReady(), /disposed/)
  } finally {
    await s.close()
  }
})

for (const mode of ['timeout', 'abort'])
  test(`WebSocket ${mode} closes the pending transport`, async () => {
    const { WebSocketServer } = await import('ws')
    const ws = new WebSocketServer({ port: 0, host: '127.0.0.1' })
    await new Promise(done => ws.once('listening', done))
    const dev = { session: 'websocket', root: '/work/p', pid: process.pid, socket: '', url: `http://127.0.0.1:${ws.address().port}/` }
    const abort = new AbortController()
    try {
      const connected = SessionLink.connect(dev, { name: 'test', version: 'dev', timeoutMs: 100, signal: abort.signal })
      const rejection = assert.rejects(connected, mode === 'timeout' ? /did not answer hello/ : /cancelled/)
      await until(() => ws.clients.size === 1)
      if (mode === 'abort') abort.abort()
      await rejection
      await until(() => ws.clients.size === 0)
    } finally {
      for (const client of ws.clients) client.terminate()
      await new Promise(done => ws.close(done))
    }
  })
