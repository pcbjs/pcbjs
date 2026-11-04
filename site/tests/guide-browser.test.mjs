import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join, resolve } from 'node:path'
import { chromes, launchAny, cdp, evaluate } from '../../scripts/browser-equality.mjs'

const dist = process.env.PCBJS_SITE_DIST ? resolve(process.env.PCBJS_SITE_DIST) : new URL('../.vitepress/dist/', import.meta.url).pathname
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function until(page, expression, ms = 15000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (await evaluate(page, expression)) return true
  return false
}
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }
test(
  'guide source, geometry, 3D and responsive layout agree in Chromium',
  { skip: !existsSync(join(dist, 'guide/getting-started/placement.html')) || !chromes().length, timeout: 150000 },
  async () => {
    const server = createServer((req, res) => {
      const path = new URL(req.url, 'http://x').pathname
      const hit = [path, path + '.html', path + '/index.html'].map(p => join(dist, p)).find(p => p.startsWith(dist) && existsSync(p) && statSync(p).isFile())
      if (!hit) return res.writeHead(404).end()
      res.writeHead(200, { 'content-type': mime[extname(hit)] ?? 'application/octet-stream' }).end(readFileSync(hit))
    })
    await new Promise(r => server.listen(0, '127.0.0.1', r))
    const tmp = mkdtempSync(join(tmpdir(), 'pcbjs-guide-browser-'))
    let chrome, page
    try {
      chrome = await launchAny(chromes(), tmp, 0)
      page = await cdp(chrome.socket)
      await page.send('Runtime.enable')
      await page.send('Page.enable')
      const origin = `http://127.0.0.1:${server.address().port}`
      await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
      await page.send('Page.navigate', { url: origin + '/guide/getting-started/placement' })
      assert.ok(await until(page, `document.querySelector('[data-example="blinky-placement"] .drawing .lit')`), 'initial lesson focus highlights rendered objects')
      const root = `document.querySelector('[data-example="blinky-placement"]')`
      const geometry = await evaluate(
        page,
        `(() => { const r = ${root}; return { refs: [...new Set([...r.querySelectorAll('.drawing [data-ref]')].map(e => e.dataset.ref))].sort(), text: r.querySelector('.source').textContent, focus: r.querySelectorAll('.source .relevant').length } })()`,
      )
      assert.deepEqual(geometry.refs, ['C1', 'J1', 'Q1'])
      assert.match(geometry.text, /import PCB/)
      assert.match(geometry.text, /export default/)
      assert.match(geometry.text, /<\/PCB>/)
      assert.ok(geometry.focus >= 3)
      await evaluate(page, `Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.__guideCopied = text } } })`)
      await evaluate(page, `${root}.querySelector('.source-actions button').click()`)
      assert.ok(await until(page, `window.__guideCopied?.includes('export default') && window.__guideCopied?.includes('</PCB>')`), 'copy supplies the complete source file')
      await evaluate(
        page,
        `Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }); document.execCommand = action => { window.__guideFallback = action === 'copy' && document.querySelector('textarea')?.value; return !!window.__guideFallback }`,
      )
      await evaluate(page, `${root}.querySelector('.source-actions button').click()`)
      assert.ok(
        await until(page, `window.__guideFallback === window.__guideCopied && !document.querySelector('textarea')`),
        'LAN fallback copies the same complete source and cleans up',
      )
      await evaluate(page, `${root}.scrollIntoView({block:'start'})`)
      await page.send('Page.captureScreenshot', { format: 'png' }).then(x => writeFileSync('/tmp/pcbjs-guide-placement-desktop.png', Buffer.from(x.data, 'base64')))
      await evaluate(
        page,
        `(() => {const r=${root}; const line=[...r.querySelectorAll('.source [data-line]')].find(e=>e.textContent.includes('<J1 at=')); line.dispatchEvent(new MouseEvent('mouseover',{bubbles:true})); })()`,
      )
      assert.ok(await until(page, `${root}.querySelector('.source .chosen')?.textContent.includes('<J1 at=')`))
      assert.ok(await until(page, `[...${root}.querySelectorAll('.drawing [data-ref].lit')].some(e=>e.dataset.ref==='J1')`), 'code hover highlights J1')
      await evaluate(page, `${root}.querySelector('.source').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))`)
      assert.ok(await until(page, `${root}.querySelector('.source .chosen')?.textContent.includes('<Q1 at=')`), 'keyboard advances source selection')
      await evaluate(page, `${root}.querySelector('.source').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`)
      assert.ok(await until(page, `!${root}.querySelector('.source .chosen')`), 'Escape restores lesson focus')
      await evaluate(page, `[...${root}.querySelectorAll('.view-tabs button')].find(e=>e.textContent==='3D').click()`)
      assert.ok(await until(page, `${root}.querySelector('.live-board.ready canvas')`, 90000), '3D compiles the same lesson source')
      await evaluate(page, `[...${root}.querySelectorAll('.view-tabs button')].find(e=>e.textContent==='2D').click()`)
      await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
      await evaluate(page, `${root}.scrollIntoView({block:'start'})`)
      await sleep(200)
      assert.ok(await evaluate(page, 'document.documentElement.scrollWidth <= window.innerWidth'), 'mobile page has no horizontal overflow')
      assert.ok(
        await evaluate(
          page,
          `(() => {const r=${root};return r.querySelector('.preview-pane').getBoundingClientRect().top >= r.querySelector('.source-pane').getBoundingClientRect().bottom - 2})()`,
        ),
        'mobile source and preview stack',
      )
      await page.send('Page.captureScreenshot', { format: 'png' }).then(x => writeFileSync('/tmp/pcbjs-guide-placement-mobile.png', Buffer.from(x.data, 'base64')))
      await page.send('Page.navigate', { url: origin + '/guide/getting-started/board' })
      assert.ok(await until(page, `document.querySelector('[data-example="blinky-board"] .drawing svg')`))
      assert.equal(await evaluate(page, `document.querySelectorAll('[data-example="blinky-board"] .drawing [data-ref]').length`), 0)
      await page.send('Page.navigate', { url: origin + '/guide/getting-started/schematic' })
      assert.ok(await until(page, `document.querySelector('[data-example="blinky-schematic"] .sch-sym.lit')`), 'schematic declarations map to actual symbols')
      await page.send('Page.navigate', { url: origin + '/guide/getting-started/checks' })
      assert.ok(
        await until(page, `document.querySelector('[data-example="blinky-checks"] .checks-view')?.textContent.includes('No DRC or ERC findings')`),
        'checks lesson renders the actual fourth viewer',
      )
      await page.send('Page.navigate', { url: origin + '/development/' })
      assert.ok(await until(page, `document.querySelector('#VPSidebarNav')?.textContent.includes('Syntax and semantics')`), 'development have their own sectioned sidebar')
      await evaluate(page, `document.querySelector('#VPSidebarNav a[href="/development/syntax/"]').click()`)
      assert.ok(await until(page, `document.querySelector('h1')?.textContent.includes('Syntax and semantics')`), 'section navigation opens its overview')
      await page.send('Page.navigate', { url: origin + '/docs/routing?from=legacy#branches' })
      assert.ok(
        await until(
          page,
          `location.pathname === '/development/syntax/routing' && location.search === '?from=legacy' && location.hash === '#branches' && !!document.getElementById('branches')`,
        ),
        'old reference links preserve query and section anchor',
      )
      await page.send('Page.navigate', { url: origin + '/specifications/syntax/routing?from=rename#branches' })
      assert.ok(
        await until(
          page,
          `location.pathname === '/development/syntax/routing' && location.search === '?from=rename' && location.hash === '#branches' && !!document.getElementById('branches')`,
        ),
        'Specifications links follow the rename',
      )
      await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
      await page.send('Page.navigate', { url: origin + '/development/' })
      assert.ok(await until(page, `document.querySelector('h1')?.textContent.includes('Development')`))
      assert.ok(
        await until(page, `(() => {if (document.getElementById('localsearch-input')) return true; document.querySelector('.VPNavBarSearch button')?.click(); return false})()`),
        'local search opens after hydration',
      )
      await evaluate(
        page,
        `(() => {const input=document.getElementById('localsearch-input');input.value='Route-chain syntax';input.dispatchEvent(new Event('input',{bubbles:true}))})()`,
      )
      assert.ok(
        await until(page, `[...document.querySelectorAll('#localsearch-list a')].some(a=>a.getAttribute('href')?.startsWith('/development/syntax/routing'))`),
        'search returns the canonical contract',
      )
      assert.ok(
        await evaluate(page, `[...document.querySelectorAll('#localsearch-list a')].every(a=>!a.getAttribute('href')?.startsWith('/docs/routing'))`),
        'search excludes legacy duplicates',
      )
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
      assert.ok(await until(page, `!document.getElementById('localsearch-input')`))
      await page.send('Page.captureScreenshot', { format: 'png' }).then(x => writeFileSync('/tmp/pcbjs-development-desktop.png', Buffer.from(x.data, 'base64')))
      await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
      await page.send('Page.reload')
      assert.ok(await until(page, `document.querySelector('h1')?.textContent.includes('Development')`))
      await sleep(500)
      const mobileSize = await evaluate(
        page,
        `({width: innerWidth, client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, visual: visualViewport.width})`,
      )
      assert.ok(mobileSize.scroll <= 390 && mobileSize.width <= 390, JSON.stringify(mobileSize))
      await page.send('Page.captureScreenshot', { format: 'png' }).then(x => writeFileSync('/tmp/pcbjs-development-mobile.png', Buffer.from(x.data, 'base64')))
      await evaluate(page, `document.querySelector('.VPLocalNav .menu').click()`)
      assert.ok(await until(page, `document.querySelector('.VPLocalNav .menu')?.getAttribute('aria-expanded') === 'true'`), 'specification sidebar is available on mobile')
      await evaluate(page, `document.querySelector('#VPSidebarNav a[href="/development/formats/viewer-data"]').click()`)
      assert.ok(await until(page, `document.querySelector('h1')?.textContent.includes('Viewer records and snapshots')`), 'mobile sidebar opens detailed contracts')
      assert.deepEqual(
        page.logs.filter(l => /Hydration|browser compile of .* (failed|differs)|TypeError|ReferenceError/.test(l)),
        [],
      )
    } finally {
      page?.close()
      chrome?.proc.kill()
      server.close()
      rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  },
)
