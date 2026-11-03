import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { parse, compileScript, compileStyle } from 'vue/compiler-sfc'
import { fixture } from './fixture-board.mjs'
import { chromes, launchAny, cdp, evaluate } from '../../../scripts/browser-equality.mjs'

const repo = fileURLToPath(new URL('../../../', import.meta.url))
const symbol = (ref, x) => ({ ref, value: '1k', kind: 'resistor', at: [x + 1, 12], rot: 0, flip: false, m: [1, 0, 0, 1, x + 1, 12], body: [], box: [x, 10, x + 2, 14], pins: [], names: false, refAt: [x + 3, 11], valueAt: [x + 3, 13], auto: false, path: [], items: [] })
const finding = (id, ref, at) => ({ id: `drc:clearance:${id}`, fingerprint: id, kind: 'drc', rule: 'clearance', severity: 'error', message: 'A real canvas focus target', at, refs: [ref], items: [], mark: null })
const a = finding('aaaaaaaaaaaa', 'R1', [3, 5]), b = finding('bbbbbbbbbbbb', 'R2', [22, 15])
const drawing = { grid: 1, page: [0, 0, 100, 80], symbols: [symbol('R1', 10), symbol('R2', 70)], wires: [], labels: [], junctions: [], noConnects: [], texts: [], sheets: [] }
const site = { ...fixture(), viewBox: [-5, -5, 40, 30], bbox: { x: 0, y: 0, w: 30, h: 20 }, outline: [[[0, 0], [30, 0], [30, 20], [0, 20]]], holes: '', ratsnest: [], copper: 2, thickness: 1.6, drc: [a, b], erc: [], schematic: { ...fixture().schematic, drawing, svg: { style: '', markup: '<g data-kind="sym" data-ref="R1"><rect x="10" y="10" width="2" height="4"/></g><g data-kind="sym" data-ref="R2"><rect x="70" y="10" width="2" height="4"/></g>' } } }
const styles = []
const entry = `import {createApp,h,provide,reactive,effectScope,watch} from 'vue';
import Board2D from './packages/ui/src/Board2D.vue';import BoardSch from './packages/ui/src/BoardSch.vue';
import {createBoard} from './packages/ui/src/board-store.ts';import {createPane,paneEffects} from './packages/ui/src/pane.ts';import {commandBus} from './packages/ui/src/keys.ts';
const store=createBoard('Fx');store.targets.push(${JSON.stringify(site)});
const schStore=createBoard('Fx');schStore.targets.push({...store.site,drc:[],erc:store.site.drc.map((f,i)=>({...f,id:f.id.replace('drc:','erc:'),kind:'erc',layer:'sch',at:[i?71:11,12]}))});watch(()=>store.frame,frame=>schStore.frame=frame);
const make=mode=>{const board=mode==='sch'?schStore:store;const pane=createPane(mode);effectScope(true).run(()=>paneEffects(board,pane));return {board,pane,prefs:reactive({grid:false,ratsnest:false,deep:false,theme:'dark'}),commands:commandBus(),shell:null,theme:()=> 'dark',toggle(){},say(){},open:async()=>{}}};
const contexts={d2:make('2d'),sch:make('sch')},mounted=reactive({d2:true,sch:true});
const Host={props:['kind'],setup(props){provide(Symbol.for('pcbjs:pane'),contexts[props.kind]);return()=>h(props.kind==='d2'?Board2D:BoardSch)}};
window.demo={store,schStore,contexts,mounted,focus:index=>{store.focusFinding(store.site.drc[index]);schStore.focusFinding(schStore.site.erc[index])},clear:()=>{store.selectRef(null);schStore.selectRef(null)}};
createApp({render:()=>h('div',{class:'layout'},['d2','sch'].map(kind=>h('div',{id:kind,class:'host'},mounted[kind]?[h(Host,{kind})]:[])))}).mount('#app');`
const compiled = await build({ stdin: { contents: entry, resolveDir: repo, sourcefile: 'focus-browser-entry.js' }, bundle: true, platform: 'browser', format: 'iife', write: false, loader: { '.svg': 'text' }, plugins: [{ name: 'real-vue-canvases', setup(builder) {
  builder.onLoad({ filter: /\.vue$/ }, args => {
    const { descriptor } = parse(readFileSync(args.path, 'utf8'), { filename: args.path })
    const id = `focus-${styles.length}`
    const script = compileScript(descriptor, { id, inlineTemplate: true })
    for (const style of descriptor.styles) styles.push(compileStyle({ source: style.content, filename: args.path, id: `data-v-${id}`, scoped: !!style.scoped }).code)
    return { contents: script.content.replace('export default', 'const component =') + `\ncomponent.__scopeId='data-v-${id}';export default component;`, loader: 'ts', resolveDir: dirname(args.path) }
  })
} }] })
const js = compiled.outputFiles[0].text
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const selectors = { d2: '#d2 svg.board-svg', sch: '#sch svg.sch-svg' }
const boxExpression = kind => `document.querySelector(${JSON.stringify(selectors[kind])})?.getAttribute('viewBox')`
async function until(page, expression, label = expression) {
  for (let i = 0; i < 100; i++) { if (await evaluate(page, expression)) return; await sleep(40) }
  assert.fail(`Not observed: ${label}; browser errors: ${page.logs.filter(line => /Uncaught|error|warn/i.test(line)).slice(-5).join('\n')}`)
}
const boxes = async page => Object.fromEntries(await Promise.all(Object.keys(selectors).map(async kind => [kind, await evaluate(page, boxExpression(kind))])))
async function dimensions(page) {
  return Object.fromEntries(await Promise.all(Object.keys(selectors).map(async kind => [kind, await evaluate(page, `(()=>{const r=document.querySelector(${JSON.stringify(selectors[kind])}).getBoundingClientRect();return [r.width,r.height]})()`)])))
}
function assertResized(original, oldSize, actual, size) {
  for (const kind of Object.keys(selectors)) {
    const before = original[kind].split(' ').map(Number), after = actual[kind].split(' ').map(Number)
    const scale = before[2] / oldSize[kind][0]
    const width = size[kind][0] * scale, height = size[kind][1] * scale
    const expected = [before[0] + before[2] / 2 - width / 2, before[1] + before[3] / 2 - height / 2, width, height]
    for (let i = 0; i < 4; i++) assert.ok(Math.abs(after[i] - expected[i]) < 0.0003, `${kind} resized rollback component ${i}: ${after[i]} vs ${expected[i]}`)
    assert.ok(Math.abs(after[2] / size[kind][0] - scale) < 0.000001, `${kind} preserves world units per CSS pixel`)
    assert.ok(Math.abs(after[2] / after[3] - size[kind][0] / size[kind][1]) < 0.00002, `${kind} viewBox follows the resized viewport aspect`)
  }
}
async function wheel(page, kind, delta = 25) {
  await evaluate(page, `(()=>{const e=document.querySelector(${JSON.stringify(selectors[kind])}),r=e.getBoundingClientRect();e.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2,deltaY:${delta}}))})()`)
}

test('real 2D and schematic canvases roll back focus changes, animation and offscreen cancellation', { skip: chromes().length ? false : 'no Chromium', timeout: 45000 }, async () => {
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${readFileSync(resolve(repo, 'packages/ui/src/style.css'), 'utf8')}\n${styles.join('\n')}\nhtml,body,#app{margin:0;width:100%;height:100%}.layout{display:flex;gap:10px}.host{position:relative;width:500px;height:500px;flex:none}</style></head><body><div id="app" class="pcbjs-ui" data-theme="dark"></div><script src="/app.js"></script></body></html>`
  const server = createServer((req, res) => res.writeHead(200, { 'content-type': req.url === '/app.js' ? 'text/javascript' : 'text/html' }).end(req.url === '/app.js' ? js : html))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const dir = mkdtempSync(join(tmpdir(), 'pcbjs-focus-browser-'))
  let chrome, page
  try {
    chrome = await launchAny(chromes(), dir, 0); page = await cdp(chrome.socket)
    await page.send('Runtime.enable'); await page.send('Page.enable')
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 650, deviceScaleFactor: 1, mobile: false })
    await page.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` })
    await until(page, `!!document.querySelector('#d2 svg.board-svg')&&!!document.querySelector('#sch svg.sch-svg')`)
    await sleep(100)
    for (const kind of Object.keys(selectors)) await wheel(page, kind)
    const original = await boxes(page)
    await evaluate(page, 'window.demo.focus(0)')
    for (const kind of Object.keys(selectors)) await until(page, `${boxExpression(kind)}!==${JSON.stringify(original[kind])}`, `${kind} finding A fits`)
    await sleep(450)
    const focusedA = await boxes(page)
    await evaluate(page, 'window.demo.focus(1)')
    for (const kind of Object.keys(selectors)) await until(page, `${boxExpression(kind)}!==${JSON.stringify(focusedA[kind])}`, `${kind} finding B fits`)
    await sleep(450)
    for (const kind of Object.keys(selectors)) await wheel(page, kind, -15)
    await evaluate(page, 'window.demo.clear()')
    for (const kind of Object.keys(selectors)) await until(page, `${boxExpression(kind)}===${JSON.stringify(original[kind])}`, `${kind} returns to the first checkpoint`)
    await sleep(450)
    assert.deepEqual(await boxes(page), original, 'canceled focus animation cannot overwrite rollback')

    await evaluate(page, 'window.demo.focus(0)')
    await sleep(60)
    await evaluate(page, 'window.demo.clear()')
    await sleep(600)
    assert.deepEqual(await boxes(page), original, 'cancel during an active spring returns exactly to the baseline')

    await evaluate(page, 'window.demo.focus(0)')
    await sleep(450)
    await evaluate(page, 'window.demo.mounted.d2=false;window.demo.mounted.sch=false')
    await until(page, `!document.querySelector('#d2 svg.board-svg')&&!document.querySelector('#sch svg.sch-svg')`)
    await evaluate(page, 'window.demo.clear();window.demo.clear()')
    await evaluate(page, 'window.demo.mounted.d2=true;window.demo.mounted.sch=true')
    for (const kind of Object.keys(selectors)) await until(page, `${boxExpression(kind)}===${JSON.stringify(original[kind])}`, `${kind} consumes queued rollback after actual remount`)
    await sleep(450)
    assert.deepEqual(await boxes(page), original)
    await evaluate(page, `window.demo.store.frame={ref:'R1',box:null}`)
    for (const kind of Object.keys(selectors)) await until(page, `${boxExpression(kind)}!==${JSON.stringify(original[kind])}`, `${kind} fits an underlying frame`)
    const frameFit = await boxes(page)
    for (const kind of Object.keys(selectors)) await wheel(page, kind, 10)
    const manualFrame = await boxes(page)
    await evaluate(page, 'window.demo.focus(0)')
    await sleep(450)
    await evaluate(page, 'window.demo.focus(1)')
    await sleep(450)
    await evaluate(page, 'window.demo.mounted.d2=false;window.demo.mounted.sch=false')
    await until(page, `!document.querySelector('#d2 svg.board-svg')&&!document.querySelector('#sch svg.sch-svg')`)
    await evaluate(page, 'window.demo.clear();window.demo.mounted.d2=true;window.demo.mounted.sch=true')
    for (const kind of Object.keys(selectors)) await until(page, `${boxExpression(kind)}===${JSON.stringify(manualFrame[kind])}`, `${kind} remount restores the manually adjusted underlying frame`)
    await evaluate(page, 'window.demo.store.frame=null')
    for (const kind of Object.keys(selectors)) await until(page, `${boxExpression(kind)}===${JSON.stringify(original[kind])}`, `${kind} frame cancellation returns to original`)

    await evaluate(page, 'window.demo.focus(0)')
    await sleep(450)
    await evaluate(page, `window.demo.store.frame={ref:'R1',box:null}`)
    await sleep(450)
    await evaluate(page, 'window.demo.clear()')
    for (const kind of Object.keys(selectors)) await until(page, `${boxExpression(kind)}===${JSON.stringify(frameFit[kind])}`, `${kind} reverse finding-then-frame order rebases onto frame`)
    await evaluate(page, 'window.demo.store.frame=null')
    for (const kind of Object.keys(selectors)) await until(page, `${boxExpression(kind)}===${JSON.stringify(original[kind])}`, `${kind} reverse-order frame cancellation returns to original`)

    await evaluate(page, `window.demo.store.frame={ref:'R1',box:null}`)
    for (const kind of Object.keys(selectors)) await until(page, `${boxExpression(kind)}===${JSON.stringify(frameFit[kind])}`, `${kind} frame A starts`)
    await evaluate(page, `window.demo.store.frame={ref:'R2',box:null}`)
    for (const kind of Object.keys(selectors)) await until(page, `${boxExpression(kind)}!==${JSON.stringify(frameFit[kind])}`, `${kind} frame A to B fits`)
    await evaluate(page, 'window.demo.store.frame=null')
    for (const kind of Object.keys(selectors)) await until(page, `${boxExpression(kind)}===${JSON.stringify(original[kind])}`, `${kind} frame A to B retains the first checkpoint`)

    await evaluate(page, `window.demo.store.frame={ref:null,box:[8,3,5,4]}`)
    await until(page, `${boxExpression('d2')}!==${JSON.stringify(original.d2)}`, '2D fits an explicit area')
    assert.equal(await evaluate(page, boxExpression('sch')), original.sch, 'schematic ignores a PCB-only area frame')
    await evaluate(page, 'window.demo.store.frame=null')
    await until(page, `${boxExpression('d2')}===${JSON.stringify(original.d2)}`, '2D area cancellation returns to original')

    await evaluate(page, `(()=>{const b=window.demo.schStore;const site=b.site;const drawing={...site.schematic.drawing,symbols:site.schematic.drawing.symbols.slice(0,1)};b.library={ref:'CH1',target:null,run:b.run,site:{...site,schematic:{...site.schematic,drawing}}};b.setSel({...b.sel,isolate:{ref:'CH1',context:'CH1',instances:['CH1','CH2'],preview:false,mode:'library'}})})()`)
    await until(page, `${boxExpression('sch')}!==${JSON.stringify(original.sch)}`, 'schematic library entry fits its scoped drawing')
    await wheel(page, 'sch', -25)
    await evaluate(page, 'window.demo.schStore.setSel({...window.demo.schStore.sel,isolate:null,level:null})')
    await until(page, `${boxExpression('sch')}===${JSON.stringify(original.sch)}`, 'leaving library restores the original schematic camera after manual navigation')

    await evaluate(page, `(()=>{const b=window.demo.schStore;b.library=null;b.edit.client={};b.setSel({...b.sel,isolate:{ref:'CH1',context:'CH1',instances:['CH1','CH2'],preview:false,mode:'library'}})})()`)
    await until(page, `!document.querySelector('#sch svg.sch-svg')`, 'schematic waits for a live library response')
    await evaluate(page, `(()=>{const b=window.demo.schStore;const site=b.site;const drawing={...site.schematic.drawing,symbols:site.schematic.drawing.symbols.slice(0,1)};b.library={ref:'CH1',target:null,run:b.run,site:{...site,schematic:{...site.schematic,drawing}}}})()`)
    await until(page, `${boxExpression('sch')}&&${boxExpression('sch')}!==${JSON.stringify(original.sch)}`, 'loaded library schematic fits after remount')
    await evaluate(page, 'window.demo.schStore.setSel({...window.demo.schStore.sel,isolate:null,level:null});window.demo.schStore.edit.client=null')
    await until(page, `${boxExpression('sch')}===${JSON.stringify(original.sch)}`, 'library loading preserves the original schematic camera checkpoint')

    const beforeResize = await boxes(page), originalSize = await dimensions(page)
    await evaluate(page, 'window.demo.focus(0)')
    await sleep(450)
    await evaluate(page, `for(const id of ['d2','sch']){const e=document.getElementById(id);e.style.width='400px';e.style.height='300px'}`)
    await sleep(100)
    const smaller = await dimensions(page)
    assert.ok(smaller.d2[0] < originalSize.d2[0] && smaller.sch[1] < originalSize.sch[1])
    await evaluate(page, 'window.demo.clear()')
    await sleep(100)
    assertResized(beforeResize, originalSize, await boxes(page), smaller)

    const beforeHiddenResize = await boxes(page), hiddenSize = await dimensions(page)
    await evaluate(page, 'window.demo.focus(1)')
    await sleep(450)
    await evaluate(page, 'window.demo.mounted.d2=false;window.demo.mounted.sch=false')
    await until(page, `!document.querySelector('#d2 svg.board-svg')&&!document.querySelector('#sch svg.sch-svg')`)
    await evaluate(page, `for(const id of ['d2','sch']){const e=document.getElementById(id);e.style.width='520px';e.style.height='360px'}window.demo.clear();window.demo.mounted.d2=true;window.demo.mounted.sch=true`)
    await until(page, `!!document.querySelector('#d2 svg.board-svg')&&!!document.querySelector('#sch svg.sch-svg')`)
    await sleep(150)
    assertResized(beforeHiddenResize, hiddenSize, await boxes(page), await dimensions(page))

    assert.deepEqual(page.logs.filter(line => /Uncaught|Hydration/.test(line)), [])
  } finally {
    page?.close(); chrome?.proc.kill(); await new Promise(resolve => server.close(resolve)); rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})
