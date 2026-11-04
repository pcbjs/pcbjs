// The built site, after npm run docs:build: every board ships its module facet, a page shows the posters without JavaScript and the
// live views with it in a headless Chromium. Skipped when site/.vitepress/dist is missing.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromes, launchAny, cdp, evaluate } from '../../scripts/browser-equality.mjs'

const site = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// pages.yml builds into its own folder
const dist = process.env.PCBJS_SITE_DIST ? resolve(process.env.PCBJS_SITE_DIST) : join(site, '.vitepress/dist')
const built = existsSync(join(dist, 'index.html'))
const skip = built ? false : 'the site is not built: npm run docs:build'
// the consumer references a library that scripts/check-examples.mjs installs, so a site build without it leaves the board out
const UNBUILT = new Set(['library/consumer'])

const walk = (d, out = []) => {
  for (const e of readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(join(d, e.name), out) : out.push(join(d, e.name))
  return out
}
const file = url => join(dist, decodeURIComponent(url.replace(/^\//, '')))
const cards = () => [...readFileSync(join(dist, 'examples.html'), 'utf8').matchAll(/<div class="name"[^>]*>([^<]+)<\/div>/g)].map(m => m[1])

test('every board of the gallery ships its module facet, every file it names beside it', { skip }, () => {
  const js = walk(join(dist, 'assets')).filter(f => f.endsWith('.js'))
  const urls = new Set(js.flatMap(f => [...readFileSync(f, 'utf8').matchAll(/\/pcb\/[0-9a-f]+\/[^"'`]+?\.module\.json/g)].map(m => m[0])))
  const modules = [...urls].map(u => ({ url: u, mod: JSON.parse(readFileSync(file(u), 'utf8')) }))
  const boards = new Set(modules.map(m => m.url.replace(/^.*\/(.+)\.module\.json$/, '$1')))
  for (const name of cards()) assert.ok(boards.has(name), `${name} has no module facet`)
  for (const { url, mod } of modules) {
    assert.equal(mod.root, '/project', url)
    const named = [
      mod.config,
      mod.module,
      mod.patches,
      ...(mod.modules ?? []),
      ...Object.values(mod.files ?? {}),
      ...Object.values(mod.routes ?? {}),
      ...Object.values(mod.references ?? {}),
    ]
    for (const u of named.filter(Boolean)) assert.ok(existsSync(file(u)), `${url} names ${u}, which is not in the site`)
    for (const hash of Object.values(mod.meshes ?? {})) assert.ok(existsSync(join(dist, 'models', `${hash}.bin`)), `${url}: no mesh ${hash}`)
  }
  assert.ok(existsSync(join(dist, 'pcb/runtime/browser-worker.js')), 'the compile worker')
  const examples = join(site, '../examples')
  const projects = readdirSync(examples, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .flatMap(d =>
      existsSync(join(examples, d.name, 'pcb.config.ts'))
        ? [d.name]
        : readdirSync(join(examples, d.name), { withFileTypes: true })
            .filter(s => s.isDirectory() && existsSync(join(examples, d.name, s.name, 'pcb.config.ts')))
            .map(s => `${d.name}/${s.name}`),
    )
  const html = readFileSync(join(dist, 'examples.html'), 'utf8')
  for (const p of projects.filter(p => !UNBUILT.has(p))) assert.ok(html.includes(`examples/${p}<`), `examples/${p} is not in the gallery`)
  assert.equal(existsSync(join(dist, 'viewers')), false, 'no viewer sites')
})

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.bin': 'application/octet-stream',
  '.map': 'application/json',
}

/** The built site as a static host serves it, a clean URL by its .html. */
function serve() {
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    const hit = [path, `${path}.html`, join(path, 'index.html')].map(p => join(dist, p)).find(f => f.startsWith(dist) && existsSync(f) && statSync(f).isFile())
    if (!hit) return res.writeHead(404).end()
    res.writeHead(200, { 'content-type': TYPES[extname(hit)] ?? 'application/octet-stream' }).end(readFileSync(hit))
  })
  return new Promise(done => server.listen(0, '127.0.0.1', () => done(server)))
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function until(page, expression, ms) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(250)) if (await evaluate(page, expression)) return true
  return false
}

test(
  'a page shows the posters without JavaScript and the live views with it, in Chromium',
  { skip: skip || (chromes().length ? false : 'no Chromium; set PCBJS_CHROME'), timeout: 180000 },
  async () => {
    const server = await serve()
    const origin = `http://127.0.0.1:${server.address().port}`
    const tmp = mkdtempSync(join(tmpdir(), 'pcbjs-site-'))
    const chrome = await launchAny(chromes(), tmp, 0)
    const page = await cdp(chrome.socket)
    try {
      await page.send('Runtime.enable')
      await page.send('Network.enable')
      await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
      const posters = new Map()
      page.on('Network.responseReceived', p => /\/assets\/.*\.svg$/.test(p.response.url) && posters.set(p.response.url, p.response.status))
      await page.send('Emulation.setScriptExecutionDisabled', { value: true })
      await page.send('Page.navigate', { url: `${origin}/examples` })
      await sleep(3000)
      assert.ok(posters.size >= cards().length, `${posters.size} posters loaded for ${cards().length} cards`)
      for (const [url, status] of posters) assert.equal(status, 200, url)

      await page.send('Emulation.setScriptExecutionDisabled', { value: false })
      await page.send('Page.navigate', { url: `${origin}/examples/demo-blinky` })
      assert.ok(
        await until(page, `!!document.querySelector('.board-page .stage canvas') && !document.querySelector('.board-page img.poster')`, 90000),
        'the 3D view replaced the poster',
      )
      await evaluate(page, `document.querySelector('.board-page .view-tabs button:nth-child(1)').click()`)
      assert.ok(await until(page, `!!document.querySelector('.board-page .board-view svg.board-svg')`, 20000), 'the 2D view')
      await evaluate(page, `document.querySelector('.board-page .view-tabs button:nth-child(3)').click()`)
      assert.ok(await until(page, `!!document.querySelector('.board-page .sch-sym')`, 20000), 'the schematic')
      const bad = page.logs.filter(l => /Hydration|browser compile of .* (failed|differs)/.test(l))
      assert.deepEqual(bad, [], bad.join('\n'))
    } finally {
      page.close()
      chrome.proc.kill()
      server.close()
      rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  },
)

test('syntax colors share a content-addressed stylesheet across documentation pages', { skip }, () => {
  const pages = ['guide/getting-started/placement.html', 'development/syntax/routing.html']
  const links = pages.map(p => {
    const html = readFileSync(join(dist, p), 'utf8')
    const link = html.match(/href="([^"]*assets\/code-tokens\.[a-f0-9]+\.css)"/)?.[1]
    assert.ok(link, `${p} loads syntax colors`)
    const css = readFileSync(join(dist, link.replace(/^.*?(assets\/)/, '$1')), 'utf8')
    const tokens = [...html.matchAll(/class="(?:[^" ]+ )*(t\d+)(?: [^"]*)?"/g)].map(m => m[1])
    assert.ok(tokens.length, `${p} has highlighted code`)
    for (const token of tokens) assert.ok(css.includes(`.${token}{`), `${p}: missing ${token}`)
    return link
  })
  assert.equal(links[0], links[1], 'navigation retains one complete syntax palette')
})
