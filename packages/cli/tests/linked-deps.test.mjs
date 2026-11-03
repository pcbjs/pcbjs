// A linked @pcbjs/ui's rebuilt dist, or its @pcbjs/core's, reaches the dev server's prebundle, on start and while it runs, though the lockfile never changes.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer as netServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { createServer } from 'vite'
import { distStamp, isLinked, linkedDepsPlugin, withDeps } from '../dist/server/linked-deps.js'

const root = realpathSync(mkdtempSync(join(tmpdir(), 'pcbjs-linked-')))
const tree = join(root, 'tree')
const ui = join(tree, 'packages', 'ui')
const core = join(tree, 'packages', 'core')
const cacheDir = join(root, 'app', '.pcbjs', 'cache', 'vite')
const bundle = join(cacheDir, 'deps', '@pcbjs_ui.js')
const servers = []

after(async () => {
  for (const s of servers) await s.close()
  // Vite leaves its esbuild service running after close, which keeps the test process up
  await createRequire(import.meta.resolve('vite'))('esbuild').stop()
  rmSync(root, { recursive: true, force: true })
})

const writeUi = label => writeFileSync(join(ui, 'dist', 'index.js'), `import { word } from '@pcbjs/core'\nexport const label = '${label}' + word\n`)
const writeCore = word => writeFileSync(join(core, 'dist', 'index.js'), `export const word = '${word}'\n`)

function writePackage(dir, name, dependencies) {
  mkdirSync(join(dir, 'dist'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, type: 'module', exports: { '.': './dist/index.js', './package.json': './package.json' }, dependencies }))
  symlinkSync(join('..', '..', 'packages', name.split('/')[1]), join(tree, 'node_modules', name), 'dir')
}

// a checkout's layout: node_modules/@pcbjs links each package, and the project links that whole folder
function setup() {
  mkdirSync(join(tree, 'node_modules', '@pcbjs'), { recursive: true })
  writePackage(ui, '@pcbjs/ui', { '@pcbjs/core': '*' })
  writePackage(core, '@pcbjs/core', {})
  writeUi('alpha')
  writeCore('core-one')
  mkdirSync(join(root, 'app', 'node_modules'), { recursive: true })
  symlinkSync(join(tree, 'node_modules', '@pcbjs'), join(root, 'app', 'node_modules', '@pcbjs'), 'dir')
  writeFileSync(join(root, 'app', 'index.html'), '<script type="module">import "@pcbjs/ui"</script>\n')
}

const freePort = () =>
  new Promise(done => {
    const s = netServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => done(port))
    })
  })

async function serve() {
  const server = await createServer({
    root: join(root, 'app'),
    configFile: false,
    logLevel: 'silent',
    cacheDir,
    optimizeDeps: { entries: [join(root, 'app', 'index.html')], include: ['@pcbjs/ui'] },
    plugins: [linkedDepsPlugin(withDeps('@pcbjs/ui', realpathSync(join(root, 'app', 'node_modules', '@pcbjs', 'ui'))))],
    server: { port: await freePort(), host: '127.0.0.1', strictPort: true },
  })
  servers.push(server)
  await server.listen()
  return server
}

const until = async (pred, ms = 20000) => {
  const end = Date.now() + ms
  while (!pred()) {
    if (Date.now() > end) throw new Error('timed out')
    await new Promise(r => setTimeout(r, 50))
  }
}

const bundled = label => existsSync(bundle) && readFileSync(bundle, 'utf8').includes(label)

test('a package outside node_modules is linked, one inside is not', () => {
  assert.equal(isLinked('/work/pcbjs/packages/ui'), true)
  assert.equal(isLinked('/work/app/node_modules/@pcbjs/ui'), false)
})

test('the prebundle follows a linked ui and its core across restarts and while the server runs', async () => {
  setup()
  await serve()
  await until(() => bundled('alpha') && bundled('core-one'))
  await servers.pop().close()

  writeUi('bravo')
  const server = await serve()
  await until(() => bundled('bravo'))

  const reloads = []
  const hot = server.environments.client.hot
  const send = hot.send.bind(hot)
  hot.send = (payload, ...rest) => {
    if (payload?.type === 'full-reload') reloads.push(payload)
    return send(payload, ...rest)
  }
  await until(() => [ui, core].every(d => join(d, 'dist') in server.watcher.getWatched()))
  const before = distStamp(ui)
  writeUi('charlie')
  assert.notEqual(distStamp(ui), before)
  await until(() => bundled('charlie'))
  await until(() => reloads.length > 0)

  writeCore('core-two')
  await until(() => bundled('core-two'))
  await until(() => reloads.length > 1)
})
