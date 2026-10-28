// The extension side of the workspace dev server, without VS Code: the host, one PcbjsServer for two workspace folders spawned
// for real with `pcbjs dev --workspace`, and the sync, against a fake editor. Focus moves between the two projects, and a
// server started by hand inside the workspace yields to the hosted one.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import * as path from 'node:path'
import { until } from './fake.mjs'
import { makeWorkspace } from '../../cli/tests/fixtures/workspace.mjs'

const require = createRequire(import.meta.url)
const { IdeHost } = require('../dist/host.cjs')
const { PcbjsServer } = require('../dist/server.cjs')
const { Sync } = require('../dist/sync.cjs')

const w = makeWorkspace()
const f1 = realpathSync(w.f1),
  f2 = realpathSync(w.f2),
  alpha = path.join(f1, 'alpha')
const started = []
after(() => {
  for (const p of started) if (p.exitCode === null) p.kill('SIGKILL')
  rmSync(w.root, { recursive: true, force: true })
})

test('one hosted server for two folders: focus switches the scope, the preview URL follows, a hand-started server yields', { timeout: 180000 }, async () => {
  const selects = []
  const lines = []
  let server
  const host = new IdeHost({ name: 'vscode-pcbjs', version: '0.3.0', editor: { select: r => selects.push(r) }, target: info => (server.owns(info) ? server : undefined) })
  const url = await host.listen()
  const scopes = []
  server = new PcbjsServer({
    folders: () => [f1, f2],
    candidates: () => [alpha, f2],
    ideUrl: () => url,
    nodePath: () => process.execPath,
    output: l => lines.push(l),
    onScope: s => scopes.push(s),
    readyTimeoutMs: 120000,
  })
  const sync = new Sync({
    frameMs: 10,
    route: file => {
      const c = host.route(file)
      return c?.root ? { root: c.root, send: (e, d) => c.send(e, d) } : undefined
    },
  })
  try {
    await server.start()
    const viewer = await server.whenReady()
    assert.match(viewer, /^http:\/\/127\.0\.0\.1:\d+\/$/)
    assert.deepEqual(server.folders, [f1, f2])
    await until(() => server.scopes?.scopes.length === 2, 20000)
    assert.deepEqual(
      server.scopes.scopes.map(s => [s.slug, s.status]),
      [
        ['alpha', 'unloaded'],
        ['f2', 'unloaded'],
      ],
    )
    const spawned = lines.find(l => l.startsWith('$ '))
    assert.ok(spawned.includes(` dev --workspace ${f1} ${f2} --ide=<host> --port 0 --host 127.0.0.1`), spawned)

    // a file of folder two routes to the one server and shows its project
    assert.ok(sync.focus(path.join(f2, 'pcb.tsx')))
    await until(() => server.scope?.scope === 'f2' && server.boards?.scope === 'f2', 60000)
    assert.deepEqual(
      server.boards.boards.map(b => b.name),
      ['Beta'],
    )
    assert.equal(server.boards.root, f2)
    assert.equal(server.scope.url, `${viewer}f2/`)

    // a file of the other project switches the scope, and the preview URL with it
    assert.ok(sync.focus(path.join(alpha, 'pcb.tsx')))
    await until(() => server.scope?.scope === 'alpha' && server.boards?.scope === 'alpha', 60000)
    assert.deepEqual(
      server.boards.boards.map(b => [b.name, b.status]),
      [['Alpha', 'ok']],
    )
    assert.equal(server.scope.url, `${viewer}alpha/`)
    assert.deepEqual(
      scopes.map(s => s.scope),
      ['f2', 'alpha'],
    )
    await until(() => server.scopes.scopes.every(s => s.status === 'ok'), 10000)

    // the cursor goes to the same server; a select from the viewer reaches the editor
    sync.cursor(path.join(alpha, 'pcb.tsx'), 6, 5)
    const r = await fetch(`${viewer}__pcbjs/open?file=pcb.tsx&line=6&col=5`)
    assert.equal(r.headers.get('x-pcbjs-opened'), 'host')
    await until(() => selects.length === 1)
    assert.equal(selects[0].file, path.join(alpha, 'pcb.tsx'))

    // each loaded project has a dev.json naming its route, owned by the hosted child
    const info = JSON.parse(readFileSync(path.join(alpha, '.pcbjs', 'dev.json'), 'utf8'))
    assert.deepEqual([info.scope, info.route, info.pid], ['alpha', '/alpha/', server.pid])
    assert.ok(server.covers(info))

    // a server started by hand in a project of the workspace: the fallback leaves it alone while the hosted one runs
    const bin = path.join(w.root, 'node_modules', '@pcbjs', 'pcbjs', 'bin', 'pcbjs.js')
    const hand = spawn(process.execPath, [bin, 'dev', '--port', '0', '--host', '127.0.0.1'], { cwd: f2, stdio: 'ignore', env: { ...process.env, NO_COLOR: '1' } })
    started.push(hand)
    const devJson = path.join(f2, '.pcbjs', 'dev.json')
    await until(() => existsSync(devJson) && JSON.parse(readFileSync(devJson, 'utf8')).pid === hand.pid, 60000)
    const handInfo = JSON.parse(readFileSync(devJson, 'utf8'))
    assert.equal(handInfo.route, '/')
    assert.ok(server.covers(handInfo), 'the hosted server covers it')
    await server.stop()
    assert.ok(!server.covers(handInfo), 'with the hosted server stopped the fallback takes it')
    hand.kill('SIGTERM')
    await new Promise(r => (hand.exitCode !== null ? r() : hand.once('exit', r)))
  } finally {
    sync.dispose()
    await server.stop()
    await host.close()
  }
})
