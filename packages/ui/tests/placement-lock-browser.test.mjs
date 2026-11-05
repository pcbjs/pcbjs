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
import { chromes, launchAny, stopChrome, cdp, evaluate } from '../../../scripts/browser-equality.mjs'

const repo = fileURLToPath(new URL('../../../', import.meta.url))
const styles = []
let scopeId = 0
const site = fixture()
site.dev = { snapshot: 's1' }
site.edit = [{ ref: 'R1', caps: ['placed', 'layered'], at: [1, 5, 0], side: 'F', m: [1, 0, 0, 1, 0, 0], grid: null, src: { at: { file: 'pcb.tsx', line: 1, col: 1 } } }]
const entry = `import {createApp,h,provide,reactive,computed} from 'vue';
import EditBar from './packages/ui/src/EditBar.vue';import LockButton from './packages/ui/src/LockButton.vue';
import {usePlacementLock} from './packages/ui/src/use/placement-lock.ts';import {useGesture} from './packages/ui/src/gesture.ts';
import {createBoard} from './packages/ui/src/board-store.ts';import {createPane} from './packages/ui/src/pane.ts';import {commandBus} from './packages/ui/src/keys.ts';
const store=createBoard('Fx');store.targets.push(${JSON.stringify(site)});store.run=1;store.selectRef('R1');
const state={pcb:false,sch:false,expression:false,writes:0};let target,update;
const refresh=()=>{store.targets.splice(0,1,{...store.site,edit:store.site.edit.map(n=>({...n,locked:state.pcb})),footprints:store.site.footprints.map(f=>f.ref==='R1'?{...f,locked:state.pcb}:f)});store.run++};
store.edit.mode={mode:'rw',editor:true};store.edit.client={
lockState:async p=>({locked:state[p.view],reason:state.expression?'Lock state is derived from an expression and cannot be overridden.':null}),
begin:async p=>{target=p;return {txn:'t1',tools:[]}},update:async(id,u)=>{update=u;return {files:[],notes:[]}},
commit:async()=>{state[target.view]=update.locked;state.writes++;refresh();return {written:[{applied:true,file:'pcb.tsx',via:'editor'}]}},cancel:async()=>null};
const Host={props:['mode'],setup(props){const ctx={board:store,pane:createPane(props.mode),commands:commandBus(),prefs:reactive({grid:true,ratsnest:false,deep:false}),shell:null,theme:()=> 'dark',say(){},open:async()=>{}};provide(Symbol.for('pcbjs:pane'),ctx);
if(props.mode==='sch'){const lock=usePlacementLock(ctx);return()=>h('div',{class:'bv-edit',role:'toolbar'},[h(LockButton,{control:lock})])}
const tl=useGesture({board:()=>store.site,sel:()=>store.sel,drawn:()=>store.drawn,store,px:()=>0.1,vb:()=>[0,0,30,30],boardAt:()=>[0,0]});
const as={on:computed(()=>false),ends:computed(()=>false),ctx:computed(()=>null),chip:computed(()=>null)};
return()=>h(EditBar,{tl,as,chip:{x:0,y:0}})}};
window.demo={store,state,expression:(on,locked)=>{state.expression=on;state.pcb=locked;refresh()}};
createApp({render:()=>h('div',{},['2d','3d','sch'].map(mode=>h('section',{id:mode},[h('h3',mode),h(Host,{mode})])))}).mount('#app');`
const compiled = await build({
  stdin: { contents: entry, resolveDir: repo, sourcefile: 'lock-browser-entry.js' },
  bundle: true,
  platform: 'browser',
  format: 'iife',
  write: false,
  loader: { '.svg': 'text' },
  plugins: [
    {
      name: 'real-vue-canvases',
      setup(builder) {
        builder.onLoad({ filter: /\.vue$/ }, args => {
          const { descriptor } = parse(readFileSync(args.path, 'utf8'), { filename: args.path })
          const id = `focus-${scopeId++}`
          const script = compileScript(descriptor, { id, inlineTemplate: true })
          for (const style of descriptor.styles) styles.push(compileStyle({ source: style.content, filename: args.path, id: `data-v-${id}`, scoped: !!style.scoped }).code)
          return {
            contents: script.content.replace('export default', 'const component =') + `\ncomponent.__scopeId='data-v-${id}';export default component;`,
            loader: 'ts',
            resolveDir: dirname(args.path),
          }
        })
      },
    },
  ],
})
const js = compiled.outputFiles[0].text
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function until(page, expression) {
  for (let i = 0; i < 80; i++) {
    if (await evaluate(page, expression)) return
    await sleep(30)
  }
  assert.fail(`Not observed: ${expression}; ${page.logs.join('\n')}`)
}
const button = mode => `document.getElementById('${mode}')?.querySelector('.lock-button')`
async function click(page, mode) {
  const [x, y] = await evaluate(page, `(()=>{const r=${button(mode)}.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`)
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
}

test('real toolbars toggle and synchronize locks; expression controls stay disabled with a hover explanation', { skip: !chromes().length, timeout: 30000 }, async () => {
  const html = `<!doctype html><html><head><style>${readFileSync(resolve(repo, 'packages/ui/src/style.css'), 'utf8')}\n${styles.join('\n')}\nsection{position:relative;height:180px}body{margin:0}.bv-edit{bottom:20px}</style></head><body><div id="app" class="pcbjs-ui" data-theme="dark"></div><script src="/app.js"></script></body></html>`
  const server = createServer((req, res) => res.writeHead(200, { 'content-type': req.url === '/app.js' ? 'text/javascript' : 'text/html' }).end(req.url === '/app.js' ? js : html))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const dir = mkdtempSync(join(tmpdir(), 'pcbjs-lock-browser-'))
  let chrome, page
  try {
    chrome = await launchAny(chromes(), dir, 0)
    page = await cdp(chrome.socket)
    await page.send('Runtime.enable')
    await page.send('Page.enable')
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 650, deviceScaleFactor: 1, mobile: false })
    await page.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` })
    await until(page, `${button('2d')} && !${button('2d')}.disabled`)
    await click(page, '2d')
    await until(page, `${button('3d')}.getAttribute('aria-label')==='Unlock placement' && !${button('3d')}.disabled`)
    assert.equal(await evaluate(page, `document.getElementById('2d').querySelector('[aria-label="Placement X"]').disabled`), true)
    assert.equal(await evaluate(page, `${button('sch')}.getAttribute('aria-label')`), 'Lock placement')
    await click(page, '3d')
    await until(page, `${button('2d')}.getAttribute('aria-label')==='Lock placement' && !${button('2d')}.disabled`)
    assert.equal(await evaluate(page, `document.getElementById('2d').querySelector('[aria-label="Placement X"]').disabled`), false)
    await click(page, 'sch')
    await until(page, `${button('sch')}.getAttribute('aria-label')==='Unlock placement' && !${button('sch')}.disabled`)
    assert.equal(await evaluate(page, 'demo.state.pcb'), false)
    for (const locked of [true, false]) {
      await evaluate(page, `demo.expression(true,${locked})`)
      await until(page, `${button('2d')}.disabled && ${button('2d')}.parentElement.title.includes('derived from an expression')`)
      assert.equal(await evaluate(page, `${button('2d')}.parentElement.title`), 'Lock state is derived from an expression and cannot be overridden.')
      await click(page, '2d')
      assert.equal(await evaluate(page, 'demo.state.writes'), 3)
    }
    assert.deepEqual(
      page.logs.filter(line => /Uncaught|TypeError/.test(line)),
      [],
    )
  } finally {
    page?.close()
    if (chrome) await stopChrome(chrome.proc)
    await new Promise(resolve => server.close(resolve))
    rmSync(dir, { recursive: true, force: true })
  }
})
