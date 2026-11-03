// The session relays hover between the viewers of one board and holds each board's selection: a viewer's or an agent's goes,
// stamped, to every viewer of the board, a change based on an older seq is dropped, and a viewer that connects later gets it.
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
let PORT

const root = realpathSync(mkdtempSync(join(tmpdir(), 'pcbjs-sync-')))
mkdirSync(join(root, 'node_modules'))
symlinkSync(join(REPO, 'node_modules', '@pcbjs'), join(root, 'node_modules', '@pcbjs'), 'dir')
writeFileSync(join(root, 'pcb.config.ts'), "import { defineConfig } from '@pcbjs/core'\nexport default defineConfig({ entries: ['pcb.tsx'] })\n")
writeFileSync(join(root, 'pcb.tsx'), board('Sync'))
after(() => rmSync(root, { recursive: true, force: true }))

/** A viewer of `board`, each event it got taken once by `next`. */
async function viewer(board) {
  const v = await viewerClient(PORT, { board })
  const next = async (event, ms = 3000) => {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) {
      const i = v.got.findIndex(m => m.event === event)
      if (i >= 0) return v.got.splice(i, 1)[0]
      await new Promise(r => setTimeout(r, 20))
    }
    return null
  }
  return { ...v, next }
}

const sel = (refs, anchor, extra = {}) => ({ board: 'Sync', target: null, snapshot: '', refs, anchor, level: null, isolate: null, by: 'viewer', client: null, seq: 0, ...extra })

test('two viewers see each other’s hover; the session stamps a selection, sends it to both, drops a stale one and gives it to a late viewer', async () => {
  const child = spawn(process.execPath, [BIN, 'session', 'serve', '-p', '0', '--host', '127.0.0.1'], {
    cwd: root,
    env: { ...process.env, NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  try {
    let out = ''
    child.stdout.on('data', d => {
      out += d
    })
    child.stderr.on('data', d => {
      out += d
    })
    PORT = await printedPort(() => out)
    const a = await viewer('Sync'),
      b = await viewer('Sync'),
      other = await viewer('Else')
    await new Promise(r => setTimeout(r, 200))
    const hover = { ids: [3], refs: ['R1'], net: 'VCC' }
    a.notify('session/hover', { board: 'Sync', hover })
    const h = await b.next('pcbjs:sync:hover')
    assert.deepEqual(h.hover, hover)
    assert.equal(typeof h.from, 'string')
    a.notify('session/hover', { board: 'Sync', hover: null })
    assert.equal((await b.next('pcbjs:sync:hover')).hover, null, 'the pointer leaving clears it')
    assert.equal(await a.next('pcbjs:sync:hover', 300), null, 'nothing comes back to the sender')
    // a viewer's selection reaches both viewers of the board, the sender learning its seq
    await b.request('session/select', { board: 'Sync', selection: sel(['R1', 'net:GND'], 'net:GND'), base: 0 })
    const toA = await a.next('pcbjs:select'),
      toB = await b.next('pcbjs:select')
    assert.deepEqual([toA.selection.refs, toA.selection.anchor, toA.selection.by], [['R1', 'net:GND'], 'net:GND', 'viewer'])
    assert.ok(toA.selection.seq > 0)
    assert.equal(toB.selection.seq, toA.selection.seq, 'the sender gets the same stamp')
    assert.equal(toA.selection.client.role, 'viewer')
    assert.equal(await other.next('pcbjs:select', 300), null, 'another board hears nothing')
    // a change based on the seq it saw goes; one from the same viewer based on an older seq than its last is dropped
    await a.request('session/select', { board: 'Sync', selection: sel(['R1'], 'R1'), base: toA.selection.seq })
    const next = await b.next('pcbjs:select')
    assert.deepEqual(next.selection.refs, ['R1'])
    assert.ok(next.selection.seq > toA.selection.seq)
    await a.next('pcbjs:select')
    await a.request('session/select', { board: 'Sync', selection: sel(['net:VCC'], 'net:VCC'), base: 0 })
    assert.equal(await b.next('pcbjs:select', 400), null, 'a stale change is dropped')
    // an agent selects through session/select, by references; every viewer gets it with by: agent
    const agent = await connectSession(socketOf(root), { name: 'agent', role: 'agent', project: root })
    const set = await agent.request('session/select', { board: 'Sync', refs: ['R2', 'R1'], anchor: 'R2' })
    assert.deepEqual([set.refs, set.anchor, set.by], [['R2', 'R1'], 'R2', 'agent'])
    for (const v of [a, b]) assert.deepEqual((await v.next('pcbjs:select')).selection.refs, ['R2', 'R1'])
    await assert.rejects(agent.request('session/select', { board: 'Nope', refs: [] }), /no board Nope/)
    agent.close()
    const late = await viewer('Sync')
    assert.deepEqual((await late.next('pcbjs:select')).selection.refs, ['R2', 'R1'])
    for (const v of [a, b, other, late]) v.close()
  } finally {
    await stop(child)
  }
})
