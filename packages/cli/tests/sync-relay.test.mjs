// The dev server relays hover and focus between the viewers of one board and keeps the last focus for a viewer that connects later.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import { board } from './fixtures/workspace.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const BIN = join(REPO, 'packages', 'pcbjs', 'bin', 'pcbjs.js')
const PORT = 5284

const root = realpathSync(mkdtempSync(join(tmpdir(), 'pcbjs-sync-')))
mkdirSync(join(root, 'node_modules'))
symlinkSync(join(REPO, 'node_modules', '@pcbjs'), join(root, 'node_modules', '@pcbjs'), 'dir')
writeFileSync(join(root, 'pcb.config.ts'), "import { defineConfig } from '@pcbjs/core'\nexport default defineConfig({ entries: ['pcb.tsx'] })\n")
writeFileSync(join(root, 'pcb.tsx'), board('Sync'))
after(() => rmSync(root, { recursive: true, force: true }))

async function viewer(board) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/`, 'vite-hmr')
  await new Promise((ok, fail) => { ws.once('open', ok); ws.once('error', fail) })
  const got = []
  ws.on('message', raw => { const m = JSON.parse(raw.toString()); if (m.event?.startsWith('pcbjs:sync:')) got.push(m) })
  const send = (event, data) => ws.send(JSON.stringify({ type: 'custom', event, data }))
  send('pcbjs:sync:hello', { board })
  const next = async (event, ms = 3000) => {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) { const i = got.findIndex(m => m.event === event); if (i >= 0) return got.splice(i, 1)[0].data; await new Promise(r => setTimeout(r, 20)) }
    return null
  }
  return { ws, send, next, got }
}

test('two viewers see each other’s hover and focus, a third that comes later gets the focus at once', async () => {
  const child = spawn(process.execPath, [BIN, 'dev', '-p', String(PORT), '--host', '127.0.0.1'], { cwd: root, env: { ...process.env, NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
  try {
    let out = ''
    child.stdout.on('data', d => { out += d })
    child.stderr.on('data', d => { out += d })
    const t0 = Date.now()
    while (!out.includes(`127.0.0.1:${PORT}`)) {
      if (Date.now() - t0 > 30000) throw new Error(`dev did not start:\n${out}`)
      await new Promise(r => setTimeout(r, 50))
    }
    const a = await viewer('Sync'), b = await viewer('Sync'), other = await viewer('Else')
    await new Promise(r => setTimeout(r, 200))
    const hover = { ids: [3], refs: ['R1'], net: 'VCC' }
    a.send('pcbjs:sync:hover', { board: 'Sync', hover })
    const h = await b.next('pcbjs:sync:hover')
    assert.deepEqual(h.hover, hover)
    assert.equal(typeof h.from, 'number')
    const focus = { net: 'GND', ref: 'R1', refs: [], circuit: null }
    b.send('pcbjs:sync:focus', { board: 'Sync', focus })
    assert.deepEqual((await a.next('pcbjs:sync:focus')).focus, focus)
    a.send('pcbjs:sync:hover', { board: 'Sync', hover: null })
    assert.equal((await b.next('pcbjs:sync:hover')).hover, null, 'the pointer leaving clears it')
    assert.equal(await a.next('pcbjs:sync:hover', 300), null, 'nothing comes back to the sender')
    assert.equal(await other.next('pcbjs:sync:focus', 300), null, 'another board hears nothing')
    const late = await viewer('Sync')
    assert.deepEqual((await late.next('pcbjs:sync:focus')).focus, focus)
    for (const v of [a, b, other, late]) v.ws.close()
  } finally {
    child.kill('SIGTERM')
    await new Promise(r => child.once('exit', r))
  }
})
