import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { parse, compileScript, compileStyle } from 'vue/compiler-sfc'
import { registerHooks } from 'node:module'
import { fixture } from './fixture-board.mjs'
import { chromes, launchAny, cdp, evaluate } from '../../../scripts/browser-equality.mjs'

registerHooks({ resolve: (spec, ctx, next) => {
  try { return next(spec, ctx) } catch (error) {
    if (spec.startsWith('.') && !spec.endsWith('.ts')) return next(spec + '.ts', ctx)
    throw error
  }
} })
const { findingDetails } = await import('../src/finding-details.ts')
const { findingText } = await import('../src/finding-markdown.ts')

const finding = (id, rule, kind = 'drc') => ({ id: `${kind}:${rule}:${id}`, kind, severity: kind === 'erc' ? 'warning' : 'error', rule, board: 'Fx', at: [4, 6], mark: null, fingerprint: id, message: `Full diagnostic for ${rule}: copper < limit & needs review`, refs: ['R1/1', 'R2/2'], items: [], src: [{ file: 'pcb.tsx', start: [12, 5], end: [12, 30], role: 'item' }], measured: { value: 0.08, unit: 'mm' }, required: { value: 0.2, unit: 'mm' }, provenance: [{ rule, value: { value: 0.2, unit: 'mm' }, from: 'board' }], witness: { layer: 'F.Cu', points: [[4, 6], [4.08, 6]] }, args: { note: 'Review evidence' } })
const first = finding('000000000001', 'clearance')
const second = finding('000000000002', 'short')
const third = finding('000000000003', 'unsourced-part', 'erc')

test('shared finding format preserves evidence and escapes HTML and Markdown', () => {
  const f = { ...first, args: false, customEvidence: { thermalMargin: { value: 3, unit: 'deg' } }, message: '<script>window.injected=true</script>', refs: ['R1/\"><img src=x onerror=alert(1)>'] }
  const html = findingDetails({ board: 'Fx', finding: f })
  for (const title of ['Measurements', 'Location', 'Affected entities', 'Rule provenance', 'Source', 'Geometry', 'Diagnostic identity', 'Additional details']) assert.ok(html.includes(`<h2>${title}</h2>`), title)
  assert.ok(html.includes('&lt;script&gt;window.injected=true&lt;/script&gt;'))
  assert.ok(!html.includes('<img src=x') && !html.includes('<script>'))
  const markdown = findingText(f, 'Fx')
  assert.ok(html.includes('Thermal Margin') && html.includes('3 °') && html.includes('false'))
  assert.ok(markdown.includes('Thermal Margin') && markdown.includes('3 °') && markdown.includes('false'))
  assert.ok(markdown.includes('0.08 mm') && markdown.includes('0.2 mm'))
  assert.ok(markdown.includes('Rule provenance') && markdown.includes('pcb.tsx') && markdown.includes('pcb.tsx'))
})

const repo = fileURLToPath(new URL('../../../', import.meta.url))
const componentFile = resolve(repo, 'packages/ui/src/ChecksView.vue')
const { descriptor } = parse(readFileSync(componentFile, 'utf8'), { filename: componentFile })
const component = compileScript(descriptor, { id: 'checks-test', inlineTemplate: true })
const css = compileStyle({ source: descriptor.styles[0].content, filename: componentFile, id: 'data-v-checks-test', scoped: true }).code
const site = { ...fixture(), drc: [first, second], erc: [third] }
const compiled = await build({ stdin: { contents: `import {createApp} from 'vue';import Checks from ${JSON.stringify(componentFile)};import {createBoard} from './packages/ui/src/board-store.ts';const store=createBoard('Fx');store.targets.push(${JSON.stringify(site)});window.store=store;window.copied=[];Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>window.copied.push(text)},configurable:true});window.app=createApp(Checks);window.app.provide(Symbol.for('pcbjs:pane'),{board:store,shell:null});window.app.mount('#app');`, resolveDir: repo, sourcefile: 'checks-test-entry.js' }, bundle: true, platform: 'browser', format: 'iife', write: false, plugins: [{ name: 'checks-component', setup(build) {
  build.onResolve({ filter: /^\.\/board$/ }, args => args.importer === componentFile ? { path: 'checks-context', namespace: 'test' } : null)
  build.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: `import {inject} from 'vue';export function usePane(){return inject(Symbol.for('pcbjs:pane'))}`, loader: 'js', resolveDir: repo }))
  build.onLoad({ filter: /ChecksView\.vue$/ }, () => ({ contents: component.content.replace('export default', 'const component =') + `\ncomponent.__scopeId='data-v-checks-test';export default component;`, loader: 'ts', resolveDir: resolve(repo, 'packages/ui/src') }))
} }] })
const js = compiled.outputFiles[0].text
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(page, expression) {
  for (let i = 0; i < 60; i++) { if (await evaluate(page, expression)) return; await sleep(50) }
  assert.fail(`Not observed: ${expression}`)
}

test('Checks is persistent, navigates canonical findings, shares entity selection and copies Markdown', { skip: chromes().length ? false : 'no Chromium', timeout: 30000 }, async () => {
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${readFileSync(resolve(repo, 'packages/ui/src/style.css'), 'utf8')}\n${css}\nhtml,body,#app{margin:0;width:100%;height:100%}</style></head><body><div id="app" class="pcbjs-ui" data-theme="dark"></div><script src="/app.js"></script></body></html>`
  const server = createServer((req, res) => res.writeHead(200, { 'content-type': req.url === '/app.js' ? 'text/javascript' : 'text/html' }).end(req.url === '/app.js' ? js : html))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const tmp = mkdtempSync(join(tmpdir(), 'pcbjs-checks-view-'))
  let chrome, page
  try {
    chrome = await launchAny(chromes(), tmp, 0); page = await cdp(chrome.socket)
    await page.send('Runtime.enable'); await page.send('Page.enable')
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 900, deviceScaleFactor: 1, mobile: false })
    await page.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` })
    await until(page, `document.documentElement.dataset.ready==='checks'`)
    assert.equal(await evaluate(page, 'window.store.sel.finding??null'), null, 'mount never chooses a finding')
    assert.equal(await evaluate(page, `document.querySelectorAll('.finding-row').length`), 3)
    assert.equal(await evaluate(page, `document.querySelector('#checks-list').textContent.includes('Full diagnostic')`), false, 'list uses rule labels, details own messages')
    await evaluate(page, `document.querySelector('[aria-label="Next finding"]').click()`)
    await until(page, `window.store.sel.finding===${JSON.stringify(first.id)}`)
    assert.equal(await evaluate(page, `document.querySelector('[aria-label="Previous finding"]').disabled`), true)
    assert.equal(await evaluate(page, `document.querySelector('#finding-details').textContent.includes('Full diagnostic for clearance')`), true)
    await evaluate(page, `document.querySelector('[data-ref="R1/1"]').click()`)
    assert.deepEqual(await evaluate(page, 'Array.from(window.store.sel.refs)'), ['R1/1'])
    assert.equal(await evaluate(page, 'window.store.sel.finding'), first.id)
    await evaluate(page, `document.querySelector('[data-ref="R2/2"]').dispatchEvent(new MouseEvent('click',{bubbles:true,ctrlKey:true}))`)
    assert.deepEqual(await evaluate(page, 'Array.from(window.store.sel.refs)'), ['R1/1', 'R2/2'])
    await evaluate(page, `window.store.setSel({...window.store.sel,refs:['R2/2'],anchor:'R2/2'})`)
    await until(page, `document.querySelector('[data-ref="R2/2"]').getAttribute('aria-pressed')==='true'`)
    await evaluate(page, `(()=>{const e=document.querySelectorAll('[data-ref]'),r=document.createRange();r.selectNodeContents(e[0]);r.setEnd(e[1].firstChild.firstChild,2);getSelection().removeAllRanges();getSelection().addRange(r)})()`)
    await until(page, 'window.store.sel.refs.length===2')
    await evaluate(page, `getSelection().removeAllRanges();document.getElementById('copy-markdown').click()`)
    await until(page, 'window.copied.length===1')
    assert.ok((await evaluate(page, 'window.copied[0]')).includes('## Measurements'))
    assert.equal(await evaluate(page, `document.getElementById('copy-markdown').innerText.trim()`), '')
    await evaluate(page, `Object.defineProperty(navigator,'clipboard',{value:undefined,configurable:true});window.fallback=[];document.execCommand=command=>{window.fallback.push([command,document.activeElement.value]);return true};document.getElementById('copy-markdown').focus();document.getElementById('copy-markdown').click()`)
    await until(page, 'window.fallback.length===1')
    assert.equal(await evaluate(page, 'window.fallback[0][0]'), 'copy')
    assert.ok((await evaluate(page, 'window.fallback[0][1]')).includes('## Measurements'))
    assert.equal(await evaluate(page, `document.querySelectorAll('textarea').length`), 0, 'plain HTTP copy removes temporary text')
    assert.equal(await evaluate(page, 'document.activeElement.id'), 'copy-markdown', 'plain HTTP copy restores focus')
    await evaluate(page, `document.querySelector('[aria-label="Next finding"]').click();document.querySelector('[aria-label="Toggle findings"]').click()`)
    await until(page, `window.store.sel.finding===${JSON.stringify(second.id)}`)
    assert.equal(await evaluate(page, `getComputedStyle(document.getElementById('checks-list')).display`), 'none')
    await evaluate(page, `document.querySelector('[aria-label="Next finding"]').click()`)
    await until(page, `window.store.sel.finding===${JSON.stringify(third.id)}`)
    assert.equal(await evaluate(page, `document.querySelector('[aria-label="Next finding"]').disabled`), true)
    await evaluate(page, `document.querySelector('[aria-label="Previous finding"]').click()`)
    await until(page, `window.store.sel.finding===${JSON.stringify(second.id)}`)
    await evaluate(page, `window.store.focusFinding(window.store.site.drc[0])`)
    await until(page, `document.querySelector('#finding-details h1').textContent==='Clearance'`)
    await evaluate(page, `window.store.targets.push({...window.store.site,variant:{name:'other'},drc:[],erc:[]});window.store.target='other'`)
    await until(page, `document.querySelectorAll('.finding-row').length===0`)
    assert.equal(await evaluate(page, `document.querySelector('[aria-label="Next finding"]').disabled&&document.querySelector('[aria-label="Previous finding"]').disabled`), true)
    await evaluate(page, `window.store.target=null`)
    await until(page, `document.querySelectorAll('.finding-row').length===3`)
    assert.equal(await evaluate(page, 'window.store.sel.finding??null'), null, 'returning targets does not choose a finding')
    await evaluate(page, `window.store.focusFinding(window.store.site.drc[0]);document.querySelector('[aria-label="Toggle findings"]').click()`)
    await until(page, `document.querySelector('#finding-details h1')?.textContent==='Clearance'`)
    for (const width of [320, 1000]) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false })
      assert.equal(await evaluate(page, 'document.documentElement.scrollWidth<=innerWidth'), true)
    }
    if (process.env.PCBJS_CHECKS_SHOT) {
      await evaluate(page, 'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
      const shot = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
      writeFileSync(process.env.PCBJS_CHECKS_SHOT, Buffer.from(shot.data, 'base64'))
    }
    assert.deepEqual(page.logs.filter(line => /Uncaught|Hydration/.test(line)), [])
  } finally {
    page?.close(); chrome?.proc.kill(); await new Promise(resolve => server.close(resolve)); rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})
