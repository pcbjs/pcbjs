// `?pcb:module` and `pcbjs({ boards: 'compile' })`: the fixture site builds both variants, and the board's module, as the site ships it,
// compiles in F2's fake worker in Node to the facet hashes of the Node compile the plugin made.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { createServer as createHttp } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { register } from 'node:module'
import { build, createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { checkHash, compileInBrowser, serveCompile } from '@pcbjs/compile/browser'
import { setPlatform } from '@pcbjs/core/platform'
import { facetStream } from '@pcbjs/export/internal/facet-stream'
import { pcbjs } from '../dist/vite.js'
import { targetFacets } from '../dist/board-compile.js'

const here = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(here, '..', '..', '..')
const dirs = []
after(() => {
  setPlatform(null)
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

function site() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pcbjs-module-')))
  dirs.push(root)
  cpSync(join(here, 'fixtures', 'site'), root, { recursive: true, filter: s => !s.includes('/.pcbjs') })
  mkdirSync(join(root, 'node_modules'))
  for (const p of ['@pcbjs', 'vue', 'three', '@vue']) symlinkSync(join(REPO, 'node_modules', p), join(root, 'node_modules', p), 'dir')
  return root
}

const walk = (d, out = []) => {
  for (const e of readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(join(d, e.name), out) : out.push(join(d, e.name))
  return out
}

/** F2's fake worker: serveCompile on cloned messages, files read from disk by their file URLs. */
function fakeWorker() {
  const page = { onmessage: null, postMessage: m => setTimeout(() => worker.onmessage?.({ data: structuredClone(m) })), terminate() {} }
  const worker = { onmessage: null, postMessage: m => setTimeout(() => page.onmessage?.({ data: structuredClone(m) })) }
  serveCompile(worker, { stream: facetStream, fetch: async url => new Uint8Array(readFileSync(fileURLToPath(url))), load: url => import(url) })
  return () => page
}

let built = null

test("boards: 'compile' ships the poster, the board's module and the worker, no facet files; ?pcb:module builds beside it", { timeout: 240000 }, async () => {
  const root = site()
  const out = join(root, 'dist')
  await build({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [vue(), pcbjs({ boards: 'compile' })],
    cacheDir: join(root, '.vite'),
    build: { outDir: out, rollupOptions: { input: { main: join(root, 'index.html'), compiled: join(root, 'compiled.html') } } },
  })
  const files = walk(out).map(f => f.slice(out.length + 1).replaceAll('\\', '/'))
  assert.ok(files.includes('pcb/runtime/browser-worker.js'), 'the compile worker')
  const modules = files.filter(f => f.endsWith('.module.json'))
  assert.equal(modules.length, 1, files.join('\n'))
  assert.ok(!files.some(f => /^assets\/Hello\.(layers|meta|sch|model)-.*\.json$/.test(f)), 'no facet files')
  assert.ok(
    files.some(f => /^assets\/Hello-.*\.svg$/.test(f)),
    'the poster',
  )
  const js = files.filter(f => f.endsWith('.js')).map(f => readFileSync(join(out, f), 'utf8'))
  assert.ok(
    js.some(t => t.includes('pcb/runtime/browser-worker.js') && /\.module\.json/.test(t)),
    'the board module names its module and worker',
  )
  assert.ok(
    js.some(t => t.includes('"entry":"pcb.tsx"') && t.includes('"/project"')),
    'the ?pcb:module import of compiled.ts, inlined',
  )
  const mod = JSON.parse(readFileSync(join(out, modules[0]), 'utf8'))
  assert.equal(mod.root, '/project')
  assert.equal(mod.entry, 'pcb.tsx')
  assert.ok(mod.module.startsWith('/pcb/') && existsSync(join(out, mod.module)), mod.module)
  for (const u of mod.modules) assert.ok(existsSync(join(out, u)), u)
  assert.ok(
    Object.keys(mod.expect).some(k => k.endsWith('/layers')),
    'the Node hashes it checks against',
  )
  assert.ok(mod.routes?.Hello && existsSync(join(out, mod.routes.Hello)), 'the route memo')
  built = { out, mod }
})

test('the module the site ships compiles in the fake worker to the facets Node compiled', { timeout: 120000 }, async t => {
  if (!built) return t.skip('the site did not build')
  const { out, mod } = built
  // the site's root-relative URLs as file URLs of the built site
  const module = JSON.parse(JSON.stringify(mod).replaceAll('"/pcb/', `"${pathToFileURL(out).href}/pcb/`))
  // the modules import the pcbjs packages from /pcb/lib/ under the site's base, which a page resolves and Node needs told
  const hook = `export const resolve = (s, c, next) => next(s.startsWith('/pcb/') ? ${JSON.stringify(pathToFileURL(out).href)} + s : s, c)`
  register(`data:text/javascript,${encodeURIComponent(hook)}`)
  const r = await compileInBrowser(module, { worker: fakeWorker(), want: ['meta', 'sch', 'layers', 'model', 'findings'] })
  assert.equal(r.check.ok, true, JSON.stringify(r.check))
  assert.equal(r.mismatch, undefined, `differs from Node in ${r.mismatch}`)
  const mine = targetFacets({ board: 'Hello', target: null }, r.facets)
  for (const f of ['meta', 'sch', 'layers', 'model', 'findings']) {
    const key = Object.keys(mod.expect).find(k => k.endsWith(`/${f}`))
    assert.equal(checkHash(mine.get(f).data), mod.expect[key], f)
  }
})

test('?pcb:module in dev: its files served from memory under /@pcbjs/module/', { timeout: 180000 }, async () => {
  const root = site()
  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [pcbjs({ session: false })],
    cacheDir: join(root, '.vite'),
    server: { middlewareMode: true, watch: null },
  })
  try {
    const m = await server.transformRequest('/pcb.tsx?pcb:module')
    assert.match(m.code, /\\?"module\\?":\\?"\/@pcbjs\/module\/pcb\/\w+\/pcb\.js/)
    const url = /\/@pcbjs\/module\/pcb\/\w+\/pcb\.js/.exec(m.code)[0]
    const http = createHttp(server.middlewares)
    await new Promise(done => http.listen(0, '127.0.0.1', done))
    try {
      const res = await fetch(`http://127.0.0.1:${http.address().port}${url}`)
      assert.equal(res.headers.get('content-type'), 'text/javascript')
      assert.match(await res.text(), /sourceMappingURL=pcb\.js\.map/)
    } finally {
      http.close()
    }
  } finally {
    await server.close()
  }
})
