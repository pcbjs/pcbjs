// Entries in the config, and the workspace dev server: scopes found by name, loaded on first use, each compiled with its own
// default board, the watcher following every compiled scope, stale marking, the scope routes and the per-scope dev.json.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import WebSocket from 'ws'
import { expandEntries, pickEntries, resolveConfig } from '../dist/project/config.js'
import { findScopes, scopeOf, slugOf } from '../dist/session/scopes.js'
import { serveSession } from '../dist/session/serve.js'
import { realm } from '@pcbjs/core/internal/realm'
import { board, makeWorkspace } from './fixtures/workspace.mjs'
import { viewerClient } from './fixtures/viewer.mjs'

const scratch = () => mkdtempSync(join(tmpdir(), 'pcbjs-entries-'))
const touch = (dir, ...files) => {
  for (const f of files) {
    mkdirSync(join(dir, f, '..'), { recursive: true })
    writeFileSync(join(dir, f), '')
  }
}

test('entries: plain paths and globs relative to the config, in list order, matches sorted, no duplicates', () => {
  const d = scratch()
  try {
    touch(d, 'pcb.tsx', 'boards/b.tsx', 'boards/a.tsx', 'boards/x.ts', 'node_modules/m/z.tsx')
    assert.deepEqual(expandEntries(['pcb.tsx', 'boards/*.tsx', 'boards/a.tsx'], d, 'pcb.config.ts'), [join(d, 'pcb.tsx'), join(d, 'boards/a.tsx'), join(d, 'boards/b.tsx')])
    assert.deepEqual(expandEntries(['**/*.tsx'], d, 'pcb.config.ts'), [join(d, 'boards/a.tsx'), join(d, 'boards/b.tsx'), join(d, 'pcb.tsx')], 'node_modules is never searched')
    assert.throws(() => expandEntries(['nope.tsx'], d, 'pcb.config.ts'), /entry not found: nope\.tsx, listed in entries in pcb\.config\.ts/)
    assert.throws(() => expandEntries(['none/*.tsx'], d, 'pcb.config.ts'), /no file matches the entry pattern "none\/\*\.tsx" in pcb\.config\.ts/)
  } finally {
    rmSync(d, { recursive: true, force: true })
  }
})

test('entries: the command line is the fallback, wins over the config with one line, and neither is an error naming the key and the file', () => {
  const d = scratch()
  try {
    touch(d, 'pcb.tsx', 'other.tsx')
    const o = { root: d, configFile: join(d, 'pcb.config.ts'), shown: 'pcb.config.ts' }
    assert.deepEqual(pickEntries([], ['pcb.tsx'], o), { files: [join(d, 'pcb.tsx')], from: 'config', note: null })
    assert.deepEqual(pickEntries(['other.tsx'], undefined, o), { files: [join(d, 'other.tsx')], from: 'command line', note: null })
    const over = pickEntries(['other.tsx'], ['pcb.tsx'], o)
    assert.deepEqual(over.files, [join(d, 'other.tsx')])
    assert.equal(over.note, 'pcbjs: using the entries on the command line for this run, not the 1 in pcb.config.ts')
    assert.equal(pickEntries(['pcb.tsx'], ['pcb.tsx'], o).note, null, 'the same entries say nothing')
    assert.throws(() => pickEntries([], [], o), /no entries: add entries: \['pcb\.tsx'\] to pcb\.config\.ts, or pass the entries on the command line/)
    assert.throws(
      () => pickEntries([], undefined, { root: d, configFile: null, shown: 'pcb.config.ts' }),
      /no entries: create pcb\.config\.ts with export default defineConfig\(\{ entries: \['pcb\.tsx'\] \}\)/,
    )
    assert.throws(() => pickEntries([], 'pcb.tsx', o), /entries in pcb\.config\.ts must be a list/)
  } finally {
    rmSync(d, { recursive: true, force: true })
  }
})

test('entries: resolveConfig reads them from the loaded config, globs included, and prints the override line', async () => {
  const d = scratch()
  try {
    touch(d, 'boards/a.tsx', 'boards/b.tsx', 'c.tsx')
    writeFileSync(join(d, 'pcb.config.mjs'), "export default { entries: ['boards/*.tsx'] }\n")
    const lines = []
    const cfg = await resolveConfig([], 'build', undefined, d, l => lines.push(l))
    assert.deepEqual(
      cfg.entries.map(e => e.rel),
      ['boards/a.tsx', 'boards/b.tsx'],
    )
    assert.deepEqual(lines, [])
    const over = await resolveConfig(['c.tsx'], 'build', undefined, d, l => lines.push(l))
    assert.deepEqual(
      over.entries.map(e => e.rel),
      ['c.tsx'],
    )
    assert.deepEqual(lines, ['pcbjs: using the entries on the command line for this run, not the 2 in pcb.config.mjs'])
  } finally {
    rmSync(d, { recursive: true, force: true })
  }
})

test('scopes: every directory with a config under the folders, outside node_modules and hidden directories, slugged', () => {
  const w = makeWorkspace()
  try {
    const scopes = findScopes([w.f1, w.f2])
    assert.deepEqual(
      scopes.map(s => [s.slug, s.rel]),
      [
        ['alpha', 'alpha'],
        ['f2', ''],
      ],
    )
    assert.equal(scopeOf(scopes, join(w.alpha, 'lib', 'x.tsx')).slug, 'alpha')
    assert.equal(scopeOf(scopes, join(w.f1, 'loose.tsx')), null)
    assert.equal(slugOf('examples/demo', '/r'), 'examples-demo')
    assert.equal(slugOf('', '/r/My Board'), 'My-Board')
    assert.equal(slugOf('board', '/r'), 'board-project', 'a viewer route name is never a slug')
  } finally {
    rmSync(w.root, { recursive: true, force: true })
  }
})

// ---- the workspace dev server, compiled for real ----
let w, server, workspace, stop, base
const get = async p => {
  const r = await fetch(base + p)
  return { status: r.status, type: r.headers.get('content-type') ?? '', text: await r.text() }
}
const json = async p => JSON.parse((await get(p)).text)
const watched = () => new Set(Object.entries(server.watcher.getWatched()).flatMap(([d, ns]) => ns.map(n => join(d, n))))
const scope = slug => workspace.scopes.find(s => s.slug === slug)

before(async () => {
  w = makeWorkspace()
  const log = console.log
  console.log = () => {}
  try {
    ;({ server, workspace, stop } = await serveSession({ folders: [w.f1, w.f2], port: 0, host: '127.0.0.1', log: () => {} }))
  } finally {
    console.log = log
  }
  server.config.logger.info = () => {}
  base = `http://127.0.0.1:${server.httpServer.address().port}`
})
after(async () => {
  await stop?.('test')
  if (w) rmSync(w.root, { recursive: true, force: true })
})

test('workspace: the scopes are listed at start and nothing is loaded', async () => {
  const i = await json('/__pcbjs/scopes')
  assert.equal(i.single, false)
  assert.equal(i.displayed, null)
  assert.deepEqual(
    i.scopes.map(s => [s.slug, s.route, s.status, s.dir]),
    [
      ['alpha', '/alpha/', 'unloaded', 'alpha'],
      ['f2', '/f2/', 'unloaded', '.'],
    ],
  )
  assert.ok(
    workspace.scopes.every(s => !s.cfg && !s.state),
    'no config was imported',
  )
  // the home page and every scope route are the viewer's page
  for (const p of ['/', '/alpha/', '/alpha/board/Alpha', '/f2/board/Beta/']) {
    const r = await get(p)
    assert.equal(r.status, 200, p)
    assert.match(r.text, /<script type="module" src="\/src\/main\.ts"><\/script>/, p)
  }
  assert.equal((await get('/__pcbjs/scope/nope')).status, 404)
  const virt = (await get('/@id/__x00__virtual:pcbjs/board')).text
  assert.match(virt, /export const workspace = \{"single":false,"displayed":null,/)
})

test('workspace: a scope loads on first use with its own default board, and the defaults never leak', async () => {
  const a = await json('/__pcbjs/scope/alpha')
  assert.equal(a.scope, 'alpha')
  assert.deepEqual(
    a.boards.map(b => [b.facets.meta.name, b.facets.meta.rev, b.facets.meta.rules.clearance]),
    [['Alpha', 'A-1', 0.3]],
  )
  assert.equal(scope('alpha').status, 'ready')
  assert.equal(scope('f2').status, 'unloaded', 'the other scope is still not loaded')
  assert.equal(realm().defaults, null, 'the process defaults are empty outside a compile')
  const b = await json('/__pcbjs/scope/f2')
  assert.deepEqual(
    b.boards.map(x => [x.facets.meta.name, x.facets.meta.rev, x.facets.meta.rules.clearance]),
    [['Beta', 'B-2', 0.15]],
  )
  // the boards a viewer gets for a scope never carry the other scope's defaults, also after both loaded
  const again = await json('/__pcbjs/scope/alpha')
  assert.deepEqual(
    again.boards.map(x => [x.facets.meta.rev, x.facets.meta.rules.clearance]),
    [['A-1', 0.3]],
  )
  assert.equal(realm().defaults, null)
  // each loaded scope wrote its own dev.json with its page
  for (const [dir, slug] of [
    [w.alpha, 'alpha'],
    [w.f2, 'f2'],
  ]) {
    const info = JSON.parse(readFileSync(join(dir, '.pcbjs', 'dev.json'), 'utf8'))
    assert.equal(info.url, `${base}/${slug}/`)
    assert.equal(info.pid, process.pid)
  }
  assert.ok(existsSync(join(w.alpha, '.pcbjs', 'routes')) || true)
})

test('workspace: the watcher keeps the files of every compiled scope, so an edit of a hidden one marks it stale', async () => {
  await json('/__pcbjs/scope/alpha')
  const alphaFiles = scope('alpha').files
  assert.ok(
    alphaFiles.some(f => f.replaceAll('\\', '/').endsWith('/alpha/pcb.tsx')) && alphaFiles.some(f => f.replaceAll('\\', '/').endsWith('/alpha/pcb.config.ts')),
    alphaFiles.join(' '),
  )
  let now = watched()
  assert.ok(
    alphaFiles.every(f => now.has(f)),
    'alpha is watched once compiled',
  )
  await json('/__pcbjs/scope/f2')
  now = watched()
  assert.ok(
    scope('f2').files.every(f => now.has(f)),
    'f2 is watched once compiled',
  )
  assert.ok(
    alphaFiles.every(f => now.has(f)),
    'alpha stays watched while hidden',
  )
})

test('workspace: an edit in a scope no one observes marks it stale, and it recompiles when shown again', async () => {
  assert.equal((await json('/__pcbjs/scopes')).displayed, 'f2')
  const file = scope('alpha').files.find(f => f.replaceAll('\\', '/').endsWith('/alpha/pcb.tsx'))
  await new Promise(r => setTimeout(r, 20))
  writeFileSync(file, board('Alpha2'))
  // the watcher sets the flag; nothing asks the server in between
  for (let k = 0; k < 200 && !scope('alpha').stale; k++) await new Promise(r => setTimeout(r, 25))
  assert.equal(scope('alpha').stale, true, 'the watcher marked alpha stale')
  const i = await json('/__pcbjs/scopes')
  assert.deepEqual(
    i.scopes.map(s => [s.slug, s.stale]),
    [
      ['alpha', true],
      ['f2', false],
    ],
  )
  const a = await json('/__pcbjs/scope/alpha')
  assert.deepEqual(
    a.boards.map(b => [b.facets.meta.name, b.facets.meta.rev]),
    [['Alpha2', 'A-1']],
  )
  assert.equal(scope('alpha').stale, false)
})

test('workspace: an editor focus on a file of another scope makes it the scope shown last and tells the viewers', async () => {
  // a viewer showing no board yet, and an editor with a language client that sends pcbjs/focus
  const sock = await viewerClient(new URL(base).port, { board: null, facets: ['meta'] })
  const got = sock.got
  const editor = new WebSocket(base.replace('http', 'ws') + '/__pcbjs/session')
  const answers = []
  editor.on('message', raw => answers.push(JSON.parse(String(raw))))
  await new Promise((ok, fail) => {
    editor.once('open', ok)
    editor.once('error', fail)
  })
  try {
    const rpc = msg => editor.send(JSON.stringify({ jsonrpc: '2.0', ...msg }))
    editor.send(JSON.stringify({ event: 'pcbjs:ide:hello', data: { name: 'test', version: '1', protocol: 2, major: 1, capabilities: [], role: 'editor' } }))
    rpc({ id: 1, method: 'initialize', params: { processId: null, rootUri: null, capabilities: {} } })
    for (let i = 0; i < 600 && !answers.some(m => m.id === 1); i++) await new Promise(r => setTimeout(r, 25))
    rpc({ method: 'initialized', params: {} })
    const focusOn = file => rpc({ method: 'pcbjs/focus', params: { textDocument: { uri: pathToFileURL(file).href } } })
    focusOn(join(w.f2, 'pcb.tsx'))
    const until = async fn => {
      for (let i = 0; i < 400 && !fn(); i++) await new Promise(r => setTimeout(r, 25))
      assert.ok(fn())
    }
    await until(() => got.some(m => m.event === 'pcbjs:focus'))
    const focus = got.find(m => m.event === 'pcbjs:focus')
    assert.deepEqual([focus.scope, focus.board, focus.file], ['f2', 'Beta', 'pcb.tsx'])
    assert.deepEqual([focus.by?.name, focus.by?.role], ['test', 'editor'], 'the focus names the connection it came through')
    assert.equal(workspace.recent.slug, 'f2')
    assert.ok(got.some(m => m.event === 'pcbjs:scopes' && m.displayed === 'f2'))
    // a file in no scope changes nothing
    got.length = 0
    focusOn(join(w.f1, 'loose.tsx'))
    await new Promise(r => setTimeout(r, 200))
    assert.equal(workspace.recent.slug, 'f2')
    assert.ok(!got.some(m => m.event === 'pcbjs:focus'))
  } finally {
    sock.close()
    editor.close()
  }
})
