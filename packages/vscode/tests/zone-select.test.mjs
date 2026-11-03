// A click on a pour reaches the editor: the extension's link connects to a real dev server at /__pcbjs/session, the viewer's open
// request for the zone goes out as pcbjs/select to the language client, with the whole pour() call and the stitch() call of a via.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createMessageConnection } from 'vscode-jsonrpc'
import { serveSession } from '@pcbjs/cli/internal/session/serve'
import { until } from './fake.mjs'

const require = createRequire(import.meta.url)
const { SessionLink } = require('../dist/link.cjs')
const { PcbjsSession, transports, initializationOptions } = require('../dist/lsp-client.cjs')
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

const PCB = `import PCB, { nets, pour, stitch } from '@pcbjs/core'
import { PinHeader } from '@pcbjs/lib'
const { GND, VCC } = nets()
const J1 = PinHeader(2)().connect({ 1: GND, 2: VCC })
export default (
  <PCB name="Z">
    <rect layer="Edge.Cuts" x={0} y={0} w={20} h={20} />
    <J1 at="10 10" />
    {pour(GND, 'B.Cu', 'M 0 0 H 20 V 20 H 0 Z')}
    {pour(GND, 'F.Cu', 'M 0 0 H 20 V 20 H 0 Z')}
    {stitch(GND)}
  </PCB>
)
`

test('a select of a zone and of a stitching via reaches the language client with the whole call', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pcbjs-zone-')))
  mkdirSync(join(root, 'node_modules'))
  symlinkSync(join(REPO, 'node_modules', '@pcbjs'), join(root, 'node_modules', '@pcbjs'), 'dir')
  writeFileSync(join(root, 'pcb.config.ts'), `import { defineConfig } from '@pcbjs/core'\nexport default defineConfig({ entries: ['pcb.tsx'], vite: { logLevel: 'silent' } })\n`)
  writeFileSync(join(root, 'pcb.tsx'), PCB)
  const selects = []
  let session, server, link
  try {
    session = await serveSession({ projects: [{ dir: root }], port: 0, host: '127.0.0.1', log: () => {} })
    server = session.server
    const base = `http://127.0.0.1:${server.httpServer.address().port}`
    link = await SessionLink.connect({ session: '', pid: process.pid, root, url: `${base}/`, socket: '' }, { name: 'vscode-pcbjs', version: '9.9.9' })
    const conn = createMessageConnection(...Object.values(transports(link)))
    conn.listen()
    new PcbjsSession(conn, {
      select: p => selects.push({ uri: p.primary.uri, range: p.items[0].ranges[p.primary.index] }),
      preview() {},
      applyEdit: async () => true,
      uri: f => pathToFileURL(f).href,
    })
    await conn.sendRequest('initialize', { processId: null, rootUri: null, capabilities: {}, initializationOptions: initializationOptions('9.9.9') })
    await conn.sendNotification('initialized', {})
    const site = await (await fetch(`${base}/__pcbjs/Z/board.json`)).json()
    const lines = PCB.split('\n')
    const open = async id => {
      const uid = site.items.find(i => i.id === id).uid
      const r = site.sources['pcb.tsx'].find(r => r.uids.includes(uid))
      selects.length = 0
      const res = await fetch(`${base}/__pcbjs/open?file=pcb.tsx&line=${r.start[0]}&col=${r.start[1]}&endLine=${r.end[0]}&endCol=${r.end[1]}`)
      assert.equal(res.headers.get('x-pcbjs-opened'), 'ide')
      await until(() => selects.length === 1)
      const { uri, range } = selects[0]
      assert.equal(uri, pathToFileURL(join(root, 'pcb.tsx')).href)
      assert.equal(range.start.line, range.end.line)
      return lines[range.start.line].slice(range.start.character, range.end.character)
    }
    const zones = site.items.filter(i => i.kind === 'zone')
    assert.equal(zones.length, 2)
    assert.equal(await open(zones.find(z => z.layers.includes('B.Cu')).id), `pour(GND, 'B.Cu', 'M 0 0 H 20 V 20 H 0 Z')`)
    const via = site.items.find(i => i.kind === 'via')
    assert.ok(via, 'no stitching via')
    assert.equal(await open(via.id), 'stitch(GND)')
  } finally {
    link?.close()
    await session?.stop('test')
    rmSync(root, { recursive: true, force: true })
  }
})
