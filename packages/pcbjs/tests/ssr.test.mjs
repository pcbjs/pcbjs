// The prerendered site: a tiny two-board project built through the programmatic build, then its pages and the SSR bundle checked.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from '@pcbjs/cli'
import { pageHtml, scriptJson, siteRoutes } from '@pcbjs/cli/prerender'

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// two pads joined by a track on a round board, the smallest board that compiles clean
const board = (open, close = '</PCB>') => `${open}
    <circle layer="Edge.Cuts" cx={10} cy={10} r={10} />
    <footprint ref="TP1" value="V" id="pcbjs:TestPad-2mm" at="5mm 10mm" net:pad1="V" bom={false}><pad num={1} size={2} shape="circle" /></footprint>
    <footprint ref="TP2" value="V" id="pcbjs:TestPad-2mm" at="15mm 10mm" net:pad1="V" bom={false}><pad num={1} size={2} shape="circle" /></footprint>
    <track net="V" layer="F.Cu" width={0.5} d="M 5 10 H 15" />
  ${close}`
const ALPHA = `import PCB from '@pcbjs/core'
export default (
  ${board('<PCB name="Alpha" title="Alpha Board" revision="1.0" copper={2} rules={{ clearance: 0.2, minTrackWidth: 0.2 }}>')}
)
`
const BETA = `import { variants } from '@pcbjs/core'
import JLCPCB from '@pcbjs/fab/JLCPCB/2-Layer'
import OSHPark from '@pcbjs/fab/OSHPark/2-Layer'
const PCB = variants(JLCPCB, OSHPark)
export default (
  ${board('<PCB name="Beta" title="Beta Board" revision="2.0">')}
)
`

let root, out, ssr
before(async () => {
  root = mkdtempSync(join(tmpdir(), 'pcbjs-ssr-'))
  // the fixture resolves the @pcbjs components to this checkout, as a project with them installed would
  mkdirSync(join(root, 'node_modules'))
  symlinkSync(resolve(PKG, '..', '..', 'node_modules', '@pcbjs'), join(root, 'node_modules', '@pcbjs'), 'dir')
  writeFileSync(join(root, 'pcb.config.ts'), "export default { vite: { logLevel: 'silent' } }\n")
  writeFileSync(join(root, 'alpha.tsx'), ALPHA)
  writeFileSync(join(root, 'beta.tsx'), BETA)
  const log = console.log
  console.log = () => {}
  const code = process.exitCode
  try {
    await build({ entries: ['alpha.tsx', 'beta.tsx'], root })
  } finally {
    console.log = log
    process.exitCode = code
  }
  out = join(root, '.pcbjs', 'dist')
  ssr = await import(pathToFileURL(join(root, '.pcbjs', 'cache', 'ssr', 'entry-server.mjs')).href)
})
after(() => {
  if (root) rmSync(root, { recursive: true, force: true })
})

const data = () => JSON.parse(readFileSync(join(out, '404.html'), 'utf8').match(/window\.__PCBJS_DATA__=(.*?)<\/script>/)[1])

test('ssr: every route has its own index.html with the rendered app marked data-ssr, and 404.html is the bare shell', () => {
  for (const p of ['index.html', 'board/Alpha/index.html', 'board/Beta/index.html', 'board/Beta/jlcpcb-2-layer/index.html', 'board/Beta/osh-park-2-layer/index.html']) {
    const html = readFileSync(join(out, p), 'utf8')
    assert.match(html, /<div id="app" data-ssr><div class="app/, p)
    assert.match(html, /<script>window\.__PCBJS_DATA__=\{/, p)
    // assets resolve from every depth
    assert.match(html, /src="\/assets\/index-[^"]+\.js"/, p)
  }
  const nf = readFileSync(join(out, '404.html'), 'utf8')
  assert.match(nf, /<div id="app"><\/div><script>window\.__PCBJS_DATA__=/)
  assert.doesNotMatch(nf, /data-ssr/)
  // the tools keep their JSON
  assert.ok(existsSync(join(out, 'boards.json')))
  assert.ok(existsSync(join(out, 'boards', 'Beta', 'osh-park-2-layer.json')))
})

test('ssr: a board page holds its title, the rails and the placeholder of the 2D view, and its <title>', () => {
  const html = readFileSync(join(out, 'board/Alpha/index.html'), 'utf8')
  assert.match(html, /<title>Alpha Board<\/title>/)
  assert.match(html, /<option value="Alpha" selected>Alpha Board<\/option>/)
  assert.match(html, /<aside class="rail left">.*<h2>Layers<\/h2>/s)
  assert.match(html, /<aside class="rail right">.*role="tab"/s)
  assert.match(html, /class="board-placeholder"/)
  assert.doesNotMatch(html, /class="board-view"/)
  // a target page names its target in the menu
  const t = readFileSync(join(out, 'board/Beta/osh-park-2-layer/index.html'), 'utf8')
  assert.match(t, /<title>Beta Board<\/title>/)
  assert.match(t, /aria-checked="true" class="on" href="\/board\/Beta\/osh-park-2-layer"/)
})

test('ssr: the home page lists one card per board', () => {
  const html = readFileSync(join(out, 'index.html'), 'utf8')
  assert.match(html, /<title>pcbjs · 2 boards<\/title>/)
  assert.equal((html.match(/<li class="card/g) ?? []).length, 2)
  assert.match(html, /href="\/board\/Alpha">Alpha Board<\/a>/)
  assert.match(html, /href="\/board\/Beta\/osh-park-2-layer"/)
})

test('ssr: render from the bundle gives html, title and head, and two renders share no state', async () => {
  const d = data()
  const first = await ssr.render('/', d)
  const a = await ssr.render('/board/Alpha', d)
  assert.match(a.html, /Alpha Board/)
  assert.equal(a.title, 'Alpha Board')
  assert.match(a.head, /<meta name="description" content="Alpha Board rev 1\.0/)
  const b = await ssr.render('/board/Beta/osh-park-2-layer', d)
  assert.equal(b.title, 'Beta Board')
  const home = await ssr.render('/', d)
  assert.equal(home.title, 'pcbjs · 2 boards')
  assert.equal((home.html.match(/<li class="card/g) ?? []).length, 2)
  // the board view state is per store: showing Beta's second target does not change the home page rendered after it
  assert.equal(home.html, first.html)
  const missing = await ssr.render('/does/not/exist', d)
  assert.match(missing.html, /No such board/)
  const unknown = await ssr.render('/board/Nope', d)
  assert.match(unknown.html, /No such board.*<code>Nope<\/code>/s)
})

test('ssr: an IDE pane has no header and no view switcher, only its floating row', async () => {
  const d = data()
  const pane = await ssr.render('/board/Alpha', { ...d, ide: true, ideTheme: 'dark', ideSearch: '?ide=1&panel=0&view=sch' })
  assert.doesNotMatch(pane.html, /<header/)
  assert.doesNotMatch(pane.html, /class="seg mode"/)
  assert.match(pane.html, /class="bv-tools ide-tools"/)
  for (const label of ['Layers', 'Light theme', 'Reload']) assert.match(pane.html, new RegExp(`aria-label="${label}"`))
  assert.doesNotMatch(pane.html, /aria-label="Details"/)
  const site = await ssr.render('/board/Alpha', d)
  assert.match(site.html, /<header class="topbar"/)
  assert.match(site.html, /class="seg mode"/)
})

test('ssr: the route list and the page template', () => {
  const routes = siteRoutes({ boards: [{ name: 'A' }, { name: 'B', variant: { name: 'JLCPCB 2-Layer' } }, { name: 'B', variant: { name: 'House' } }] })
  assert.deepEqual(routes, [[], ['board', 'A'], ['board', 'B'], ['board', 'B', 'jlcpcb-2-layer'], ['board', 'B', 'house']])
  assert.equal(scriptJson({ s: '</script>\u2028' }), '{"s":"\\u003c/script>\\u2028"}')
  const tpl = '<html><head><title>pcbjs</title></head><body><div id="app"></div></body></html>'
  const page = pageHtml(tpl, '{}', { html: '<p>$& $1</p>', title: 'A & B', head: '<meta name="x">' })
  assert.equal(
    page,
    '<html><head><title>A &amp; B</title>\n  <meta name="x"></head><body><div id="app" data-ssr><p>$& $1</p></div><script>window.__PCBJS_DATA__={}</script></body></html>',
  )
  assert.throws(() => pageHtml('<body></body>', '{}'), /no <div id="app">/)
})
