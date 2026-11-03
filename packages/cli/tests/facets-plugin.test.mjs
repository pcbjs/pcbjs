// The `?pcb:` imports of @pcbjs/cli/vite: the facets equal what check compiles, `?pcb:sch` alone routes nothing, a site of two
// facet imports builds with @pcbjs/ui and type-checks against @pcbjs/cli/client, an edit updates the facet modules in dev, a live
// session answers in place of a worker, and `--ui-src` wants a checkout.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { facetHash } from '@pcbjs/core/site-facets'
import { MAJOR, PROTOCOL } from '@pcbjs/core/protocol'
import { WebSocket } from 'ws'
import { pcbjs, resolveBoard } from '../dist/vite.js'
import { facetCompiler, parseFacetId } from '../dist/facet-plugin.js'
import { uiSource } from '../dist/server/vite-config.js'
import { resolveConfig } from '../dist/project/config.js'
import { pluginState } from '../dist/server/site.js'
import { compileServer } from '../dist/project/compile.js'
import { viteLoader } from '../dist/project/loader.js'
import { DATA_FORMATS, compileEntry } from '../dist/project/project.js'
import { siteFacets } from '../dist/project/facets.js'
import { liveSession } from '../dist/session/start.js'
import { stop } from './fixtures/proc.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(here, '..', '..', '..')
const BIN = join(REPO, 'packages', 'pcbjs', 'bin', 'pcbjs.js')
const dirs = []
const children = []
after(async () => {
  for (const c of children) await stop(c)
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

/** The fixture site in a folder of its own, resolving the repository's packages. */
function site() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pcbjs-facets-')))
  dirs.push(root)
  cpSync(join(here, 'fixtures', 'site'), root, { recursive: true, filter: s => !s.includes('/.pcbjs') })
  mkdirSync(join(root, 'node_modules'))
  for (const p of ['@pcbjs', 'vue', 'three', '@vue']) symlinkSync(join(REPO, 'node_modules', p), join(root, 'node_modules', p), 'dir')
  return root
}

test('a facet import names its facet, target and view; another id is none', () => {
  assert.deepEqual(parseFacetId('/a/pcb.tsx?pcb:findings&target=lite'), { file: '/a/pcb.tsx', facet: 'findings', target: 'lite', view: '2d' })
  assert.deepEqual(parseFacetId('/a/pcb.tsx?pcb:poster&view=sch'), { file: '/a/pcb.tsx', facet: 'poster', target: null, view: 'sch' })
  assert.equal(parseFacetId('/a/pcb.tsx'), null)
  assert.equal(parseFacetId('/a/pcb.tsx?raw'), null)
})

test('the facets of an import hash as check compiles them, a module that is no entry compiles too', { timeout: 180000 }, async () => {
  const root = site()
  const file = join(root, 'pcb.tsx')
  const got = await resolveBoard(file)
  assert.equal(got.header.board, 'Hello')
  assert.ok(Number.isInteger(got.header.run) && got.header.run > 0, String(got.header.run))
  const cfg = await resolveConfig([], 'build', undefined, root, () => {})
  const server = await compileServer(cfg)
  try {
    const [c] = await compileEntry(viteLoader(server), cfg, cfg.entries[0], { formats: DATA_FORMATS })
    const want = Object.fromEntries(siteFacets(c.site).map(f => [f.facet, f.hash]))
    assert.deepEqual(Object.fromEntries(Object.entries(got.facets).map(([f, d]) => [f, facetHash(d)])), want)
  } finally {
    await server.close()
  }
  const extra = await resolveBoard(join(root, 'extra.tsx'), { facets: ['meta'] })
  assert.equal(extra.header.board, 'Extra')
  assert.ok(extra.facets.meta.footprints.some(f => f.ref === 'R1'))
})

test('?pcb:sch alone runs no routing stage', { timeout: 180000 }, async () => {
  const root = site()
  const c = facetCompiler({ session: false })
  try {
    const b = await c.compile(join(root, 'pcb.tsx'), null, ['sch'])
    assert.ok(b.facets.sch && b.facets.meta, 'the schematic and the meta it comes after')
    assert.ok(!b.facets.findings && !b.facets.fab, 'no checks and no exports')
    for (const s of ['autoroute', 'tune', 'finish', 'checks']) assert.ok(!b.stages.includes(s), `${s} in ${b.stages.join(', ')}`)
  } finally {
    await c.close()
  }
})

test('a site of two facet imports builds with @pcbjs/ui: findings inline, the board as JSON files beside it', { timeout: 180000 }, async () => {
  const root = site()
  const out = join(root, 'dist')
  await build({ root, configFile: false, logLevel: 'silent', plugins: [vue(), pcbjs()], cacheDir: join(root, '.vite'), build: { outDir: out } })
  const assets = readdirSync(join(out, 'assets'))
  for (const f of ['meta', 'layers', 'findings', 'sch', 'fab', 'model'])
    assert.ok(
      assets.some(a => a.startsWith(`Hello.${f}-`) && a.endsWith('.json')),
      `Hello.${f}.json`,
    )
  assert.ok(
    assets.some(a => /^Hello-.*\.svg$/.test(a)),
    'the 2D poster',
  )
  const js = readFileSync(
    join(
      out,
      'assets',
      assets.find(a => a.endsWith('.js')),
    ),
    'utf8',
  )
  assert.match(js, /JSON\.parse\('\{"drc":\[\]/, 'the findings facet is inlined')
  assert.match(js, /new URL\("Hello\.layers-[\w-]+\.json",import\.meta\.url\)/, 'the board ref points at its files')
  assert.match(js, /board-view/, "the 2D view's markup")
  const meta = JSON.parse(
    readFileSync(
      join(
        out,
        'assets',
        assets.find(a => a.startsWith('Hello.meta-')),
      ),
      'utf8',
    ),
  )
  assert.equal(meta.name, 'Hello')
})

test('the facet imports type-check against @pcbjs/cli/client', { timeout: 120000 }, () => {
  const root = site()
  const tsc = join(REPO, 'node_modules', 'typescript', 'bin', 'tsc')
  const r = (() => {
    try {
      return { ok: true, out: execFileSync(process.execPath, [tsc, '-p', root], { encoding: 'utf8' }) }
    } catch (e) {
      return { ok: false, out: `${e.stdout}${e.stderr}` }
    }
  })()
  assert.ok(r.ok, r.out)
  writeFileSync(join(root, 'main.ts'), readFileSync(join(root, 'main.ts'), 'utf8').replace('// @ts-expect-error the findings facet holds no layers\n', ''))
  assert.throws(
    () => execFileSync(process.execPath, [tsc, '-p', root], { encoding: 'utf8', stdio: 'pipe' }),
    e => /Property 'layers' does not exist/.test(String(e.stdout)),
  )
})

test('an edit to a file the board read updates its facet modules in dev; the board module accepts itself and hands its store the newer ref', { timeout: 180000 }, async () => {
  const root = site()
  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [pcbjs({ session: false })],
    cacheDir: join(root, '.vite'),
    server: { middlewareMode: true, watch: null },
  })
  const sent = []
  const send = server.ws.send.bind(server.ws)
  server.ws.send = (event, data) => (sent.push([event, data]), send(event, data))
  try {
    const meta = await server.transformRequest('/pcb.tsx?pcb:meta')
    assert.match(meta.code, /\\?"title\\?":\\?"Hello/)
    const before = Number(/"run": ?(\d+)/.exec(meta.code)[1])
    const board = await server.transformRequest('/pcb.tsx?pcb:board')
    assert.match(board.code, /import\.meta\.hot\.accept\(\)/)
    assert.match(board.code, /\.live\(board\)/)
    assert.doesNotMatch(board.code, /"session"/, 'no live session, so the store refetches on a newer ref')
    assert.match(board.code, /\/@pcbjs\/facet\/\w+\/Hello\.layers\.json\?run=\d+&h=/)
    const file = join(root, 'pcb.tsx')
    writeFileSync(file, readFileSync(file, 'utf8').replace('<PCB name="Hello" rev="0.1.0">', '<PCB name="Hello" rev="0.2.0">'))
    const mods = await server.config.plugins.find(p => p.name === 'pcbjs:facets').handleHotUpdate({ file, modules: [], server, timestamp: Date.now(), read: async () => '' })
    assert.ok(mods.some(m => m.id?.endsWith('?pcb:meta')) && mods.some(m => m.id?.endsWith('?pcb:board')), 'both facet modules go to HMR')
    const again = await server.transformRequest('/pcb.tsx?pcb:meta')
    assert.match(again.code, /0\.2\.0/)
    const after = Number(/"run": ?(\d+)/.exec(again.code)[1])
    assert.ok(after > before, `${after} after ${before}`)
    assert.deepEqual(
      sent.filter(([e]) => typeof e === 'string' && e.startsWith('pcbjs:')),
      [],
      "Vite's socket carries nothing of pcbjs: a live store follows its session's own",
    )
  } finally {
    await server.close()
  }
})

test('a live ref names its session, and a page of the dev server follows it on the session socket through that server', { timeout: 180000 }, async () => {
  const root = site()
  let log = ''
  const serve = spawn(process.execPath, [BIN, 'session', 'serve', '--port', '0', '--host', '127.0.0.1', '--grace', '30'], { cwd: root, env: process.env })
  children.push(serve)
  serve.stdout.on('data', d => (log += d))
  serve.stderr.on('data', d => (log += d))
  for (let i = 0; i < 300 && !(await liveSession(root)); i++) await new Promise(r => setTimeout(r, 100))
  assert.ok(await liveSession(root), `no session:\n${log}`)
  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [pcbjs()],
    cacheDir: join(root, '.vite'),
    server: { port: 0, host: '127.0.0.1', watch: null },
  })
  await server.listen()
  try {
    const board = await server.transformRequest('/pcb.tsx?pcb:board')
    const ref = JSON.parse(/const board = \{ \.\.\.(\{.*?\}), facets:/s.exec(board.code)[1])
    assert.match(ref.session?.path ?? '', /^\/@pcbjs\/session\/\w+$/, board.code.slice(0, 400))
    const host = `127.0.0.1:${server.httpServer.address().port}`
    const other = new WebSocket(`ws://${host}${ref.session.path}`, { headers: { origin: 'http://evil.example' } })
    await new Promise(r => ((other.onerror = r), (other.onclose = r)))
    assert.notEqual(other.readyState, WebSocket.OPEN, 'another origin is refused, as the session refuses it')
    const page = new WebSocket(`ws://${host}${ref.session.path}`, { headers: { origin: `http://${host}` } })
    const got = []
    page.onmessage = e => got.push(JSON.parse(String(e.data)))
    await new Promise((ok, fail) => ((page.onopen = ok), (page.onerror = fail)))
    page.send(JSON.stringify({ event: 'pcbjs:ide:hello', data: { name: 'test page', version: '', protocol: PROTOCOL, major: MAJOR, capabilities: [], role: 'viewer' } }))
    page.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'session/observe', params: { board: 'Hello', target: null, facets: ['meta'], held: {} } }))
    for (let i = 0; i < 300 && !got.some(f => f.event === 'pcbjs:facet' && f.data?.facet === 'meta'); i++) await new Promise(r => setTimeout(r, 100))
    assert.ok(
      got.some(f => f.event === 'pcbjs:ide:ready'),
      'the session said ready through the dev server',
    )
    assert.ok(
      got.some(f => f.event === 'pcbjs:facet' && f.data?.board === 'Hello' && f.data?.facet === 'meta'),
      `the board's meta came on the socket: ${got.map(f => f.event ?? f.id).join(', ')}`,
    )
    page.close()
  } finally {
    await server.close()
    await stop(serve)
  }
})

test('a live session serving the project answers the data facets: the plugin starts no worker', { timeout: 180000 }, async () => {
  const root = site()
  let log = ''
  const serve = spawn(process.execPath, [BIN, 'session', 'serve', '--port', '0', '--host', '127.0.0.1', '--grace', '30'], { cwd: root, env: process.env })
  children.push(serve)
  serve.stdout.on('data', d => (log += d))
  serve.stderr.on('data', d => (log += d))
  for (let i = 0; i < 300 && !(await liveSession(root)); i++) await new Promise(r => setTimeout(r, 100))
  assert.ok(await liveSession(root), `no session:\n${log}`)
  const c = facetCompiler()
  c.serve()
  try {
    const b = await c.compile(join(root, 'pcb.tsx'), null, ['meta', 'findings'])
    assert.equal(b.via, 'session')
    assert.ok(b.run > 0, String(b.run))
    assert.equal(b.board, 'Hello')
    assert.equal(c.workers(), 0)
    const extra = await c.compile(join(root, 'extra.tsx'), null, ['meta'])
    assert.equal(extra.via, 'worker', 'a module that is no entry of the session compiles here')
  } finally {
    await c.close()
    await stop(serve)
  }
})

test('--ui-src serves a checkout: the one installed here is one, a folder without src is refused', () => {
  assert.equal(uiSource(null), join(REPO, 'packages', 'ui'))
  const empty = mkdtempSync(join(tmpdir(), 'pcbjs-ui-'))
  dirs.push(empty)
  assert.throws(() => uiSource(empty), /--ui-src needs a pcbjs checkout: .* has no src\/index\.ts/)
  assert.ok(existsSync(join(uiSource(null), 'src', 'index.ts')))
})
