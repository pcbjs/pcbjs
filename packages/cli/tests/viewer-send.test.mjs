// Send to agent from a standalone dev page: the session lists its agents to the viewers that may write, a viewer's send reaches the
// agent as the editor's message with the selection's refs, and the viewer follows its delivered events, read once the agent acks and returned when it left.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { board } from './fixtures/workspace.mjs'
import { printedPort, stop } from './fixtures/proc.mjs'
import { viewerClient } from './fixtures/viewer.mjs'
import { connectSession } from '../dist/session/client.js'
import { socketOf } from '../dist/session/paths.js'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const BIN = join(REPO, 'packages', 'pcbjs', 'bin', 'pcbjs.js')

const root = realpathSync(mkdtempSync(join(tmpdir(), 'pcbjs-vsend-')))
mkdirSync(join(root, 'node_modules'))
symlinkSync(join(REPO, 'node_modules', '@pcbjs'), join(root, 'node_modules', '@pcbjs'), 'dir')
writeFileSync(join(root, 'pcb.config.ts'), "import { defineConfig } from '@pcbjs/core'\nexport default defineConfig({ entries: ['pcb.tsx'] })\n")
writeFileSync(join(root, 'pcb.tsx'), board('Send'))
after(() => rmSync(root, { recursive: true, force: true }))

/** A standalone page: a viewer of the board that follows the `delivered` events, as the page does once it sends. */
async function viewer(port) {
  const v = await viewerClient(port, { board: 'Send', facets: ['meta'] })
  await v.request('session/events', { follow: true, kind: ['delivered'] })
  const next = async (event, test = () => true, ms = 5000) => {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) {
      const i = v.got.findIndex(m => m.event === event && test(m))
      if (i >= 0) {
        const { event: _, seq, ...data } = v.got.splice(i, 1)[0]
        return data
      }
      await new Promise(r => setTimeout(r, 20))
    }
    return null
  }
  const send = p => v.request('session/send', { ranges: [], ...p }).catch(e => ({ error: e.message }))
  return { ...v, next, send }
}

test('a standalone page lists the agents, sends its selection to one, and hears Read by and Returned', { timeout: 120000 }, async () => {
  const child = spawn(process.execPath, [BIN, 'session', 'serve', '-p', '0', '--host', '127.0.0.1'], {
    cwd: root,
    env: { ...process.env, NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  try {
    let out = ''
    child.stdout.on('data', d => (out += d))
    child.stderr.on('data', d => (out += d))
    const v = await viewer(await printedPort(() => out))
    assert.deepEqual((await v.next('pcbjs:agents')).agents, [], 'the hello gets the agents, none yet')

    const agent = await connectSession(socketOf(root), { name: 'Claude Code', role: 'agent', project: root })
    const messages = []
    agent.onEvent((e, d) => e === 'session/message' && messages.push(d))
    const listed = await v.next('pcbjs:agents', d => d.agents.length === 1)
    assert.deepEqual([listed.agents[0].name, listed.agents[0].root, typeof listed.agents[0].since], ['Claude Code', root, 'string'])

    // the page would show the board: compiled once
    await agent.request('session/boards', {})
    const sent = await v.send({ to: listed.agents[0].client, comment: 'look at these', board: 'Send', target: null, refs: ['TP2', 'TP1'], snapshot: 's.1' })
    assert.equal(sent.to.name, 'Claude Code')
    const until = async fn => {
      for (let i = 0; i < 250 && !fn(); i++) await new Promise(r => setTimeout(r, 20))
    }
    await until(() => messages.length)
    const m = messages[0]
    assert.deepEqual([m.id, m.data.from, m.data.comment, m.data.refs, m.data.board, m.by.role], [sent.id, 'editor', 'look at these', ['TP2', 'TP1'], 'Send', 'viewer'])
    assert.equal(m.data.snapshot, 's.1', 'the snapshot the page shows')
    const delivered = id => v.next('session/event', e => e.kind === 'delivered' && e.data.message === id)
    await agent.request('session/ack', { ids: [m.id] })
    assert.ok(!(await delivered(sent.id)).data.returned, 'read')

    const unread = await v.send({ to: listed.agents[0].client, comment: '', board: 'Send', target: null, refs: ['TP1'] })
    agent.close()
    assert.equal((await delivered(unread.id)).data.returned, true)
    assert.deepEqual((await v.next('pcbjs:agents', d => d.agents.length === 0)).agents, [])

    assert.match((await v.send({ to: 'c99', comment: 'x', board: 'Send', target: null, refs: [] })).error, /no agent is attached/)
    v.close()
  } finally {
    await stop(child)
  }
})
