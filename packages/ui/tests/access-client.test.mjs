import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

registerHooks({
  resolve(spec, ctx, next) {
    try {
      return next(spec, ctx)
    } catch (e) {
      if (spec.startsWith('.') && !spec.endsWith('.ts')) return next(spec + '.ts', ctx)
      throw e
    }
  },
})
const { openTarget } = await import('../src/open.ts')
const { sessionUrl } = await import('../src/transport.ts')

test('remote edit token reaches the session handshake without unrelated query fields', () => {
  assert.equal(sessionUrl({ protocol: 'https:', host: 'dev.example.test', search: '?token=a%2Bb&view=3d' }), 'wss://dev.example.test/__pcbjs/session?token=a%2Bb')
  assert.equal(sessionUrl({ protocol: 'http:', host: 'localhost:1234' }), 'ws://localhost:1234/__pcbjs/session')
})

test('selection never opens repository tabs; only an explicit source action may do so', async () => {
  const opened = [],
    fetched = []
  const oldWindow = globalThis.window,
    oldLocation = globalThis.location,
    oldFetch = globalThis.fetch
  globalThis.window = { open: (...args) => opened.push(args) }
  globalThis.location = { search: '?token=remote-token' }
  globalThis.fetch = async (...args) => {
    fetched.push(args)
    return { ok: true }
  }
  const board = { dev: false, repo: { url: 'https://github.com/example/board', ref: 'main', dir: '', kind: 'github' } }
  const target = { file: 'pcb.tsx', start: [5, 1], end: [5, 20] }
  try {
    await openTarget(board, target, () => {})
    await openTarget(board, target, () => {}, true, { external: true })
    await openTarget({ ...board, dev: true }, target, () => {})
    assert.equal(opened.length, 0)
    assert.equal(fetched.length, 0)
    await openTarget(board, target, () => {}, false, { external: true })
    assert.equal(opened.length, 1)
    assert.equal(opened[0][1], '_blank')
    await openTarget({ ...board, dev: true }, target, () => {}, true, { editable: true })
    assert.equal(fetched.length, 1)
    assert.equal(fetched[0][1].headers.authorization, 'Bearer remote-token')
  } finally {
    globalThis.window = oldWindow
    globalThis.location = oldLocation
    globalThis.fetch = oldFetch
  }
})
