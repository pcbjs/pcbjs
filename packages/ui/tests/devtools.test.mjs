import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { parse, compileScript, compileStyle } from 'vue/compiler-sfc'
import { chromes, launchAny, stopChrome, cdp, evaluate } from '../../../scripts/browser-equality.mjs'
const repo = fileURLToPath(new URL('../../../', import.meta.url))
const file = resolve(repo, 'packages/ui/src/DevToolsOverlay.vue')
const { descriptor } = parse(readFileSync(file, 'utf8'), { filename: file })
const component = compileScript(descriptor, { id: 'inspector-test', inlineTemplate: true })
const css = compileStyle({ source: descriptor.styles[0].content, filename: file, id: 'data-v-inspector-test', scoped: true }).code
const compiled = await build({
  stdin: {
    contents: `import {createApp,reactive} from 'vue';import Inspector from ${JSON.stringify(file)};import {uiTree,uiSnapshot} from './packages/ui/src/devtools.ts';window.uiTree=uiTree;window.uiSnapshot=uiSnapshot;window.ctx=reactive({board:{name:'Blinky',site:{variant:null},sel:{refs:['CH1'],anchor:'CH1'}},pane:{devtools:true,mode:'2d',side:'F',mirror:false,explode:false,separation:4,hidden:new Set()}});const app=createApp(Inspector);app.provide(Symbol.for('pcbjs:pane'),ctx);app.mount('#app');window.copied=[];Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>copied.push(JSON.parse(text))}});window.hits=0;document.querySelector('#target').addEventListener('pointerdown',()=>hits++);window.outsideHits=0;document.querySelector('#outside').addEventListener('pointerdown',()=>outsideHits++);window.ready=true;`,
    resolveDir: repo,
    sourcefile: 'inspector-test.js',
  },
  bundle: true,
  platform: 'browser',
  format: 'iife',
  write: false,
  plugins: [
    {
      name: 'inspector',
      setup(b) {
        b.onLoad({ filter: /DevToolsOverlay\.vue$/ }, () => ({
          contents: component.content.replace('export default', 'const component =') + "\ncomponent.__scopeId='data-v-inspector-test';export default component",
          loader: 'ts',
          resolveDir: dirname(file),
        }))
      },
    },
  ],
})
const js = compiled.outputFiles[0].text
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function until(page, expr) {
  for (let i = 0; i < 100; i++) {
    if (await evaluate(page, expr)) return
    await sleep(20)
  }
  assert.fail(expr)
}
test(
  'inspector exposes live hierarchy and properties, picks without editing, and copies a bounded report',
  { skip: chromes().length ? false : 'no Chromium', timeout: 30000 },
  async () => {
    const server = createServer((req, res) => {
      res.setHeader('content-type', req.url === '/app.js' ? 'text/javascript' : 'text/html')
      res.end(
        req.url === '/app.js'
          ? js
          : `<style>${css}.stage{position:relative;height:600px}button{padding:8px}</style><button id="outside">Outside stage</button><main class="stage" data-ui="BoardFrame"><section data-ui="EditBar" data-ui-source="packages/ui/src/EditBar.vue"><button id="target" aria-label="Trace layer">F.Cu</button><input aria-label="X" value="16"><button hidden>Hidden</button></section><div id="app"></div></main><script src="/app.js"></script>`,
      )
    })
    await new Promise(r => server.listen(0, '127.0.0.1', r))
    const dir = mkdtempSync(join(tmpdir(), 'pcbjs-inspector-'))
    let chrome, page
    try {
      chrome = await launchAny(chromes(), dir, 0)
      page = await cdp(chrome.socket)
      await page.send('Runtime.enable')
      await page.send('Page.enable')
      await page.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` })
      await until(page, 'window.ready && document.querySelectorAll(".ui-tree button").length===4')
      const tree = await evaluate(page, 'uiSnapshot(uiTree(document.querySelector(".stage")))')
      assert.deepEqual(
        tree.map(n => n.label),
        ['BoardFrame', 'EditBar', 'Trace layer', 'X'],
      )
      assert.equal(tree[2].parent, tree[1].id)
      assert.equal(tree[2].source, 'packages/ui/src/EditBar.vue')
      assert.equal(tree[3].properties.value, '16')
      await evaluate(page, `document.querySelector('[aria-label="Pick an element"]').click()`)
      await evaluate(page, `document.querySelector('#outside').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true}))`)
      assert.equal(await evaluate(page, 'outsideHits'), 1, 'picking only shields the stage represented in the hierarchy')
      assert.equal(await evaluate(page, `document.querySelector('[aria-label="Pick an element"]').getAttribute('aria-pressed')`), 'true')
      const rect = await evaluate(page, '(()=>{const r=document.querySelector("#target").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()')
      await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...rect, button: 'left', clickCount: 1 })
      await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...rect, button: 'left', clickCount: 1 })
      await until(page, 'document.querySelector(".ui-inspector-highlight")!==null')
      assert.equal(await evaluate(page, 'hits'), 0, 'picking must not start a board gesture')
      assert.deepEqual(JSON.parse(await evaluate(page, 'JSON.stringify(ctx.board.sel.refs)')), ['CH1'])
      await evaluate(page, 'document.querySelector("#target").setAttribute("disabled","")')
      await until(page, `document.querySelector('pre').textContent.includes('"disabled": true')`)
      await evaluate(page, `(()=>{const input=document.querySelector('input[aria-label="X"]');input.value='32';document.querySelector('[aria-label="Copy UI report"]').click()})()`)
      await until(page, 'copied.length===1')
      assert.equal(await evaluate(page, 'copied[0].state.board'), 'Blinky')
      assert.equal(await evaluate(page, `copied[0].tree.find(n=>n.label==='X').properties.value`), '32', 'Copy captures property changes even without an input event')
      await evaluate(
        page,
        `[...document.querySelectorAll('.ui-tree button')].find(e=>e.textContent.trim().endsWith('X')).click();const input=document.querySelector('input[aria-label="X"]');input.value='48';input.dispatchEvent(new Event('input',{bubbles:true}))`,
      )
      await until(page, `document.querySelector('pre').textContent.includes('"value": "48"')`)

      assert.equal(await evaluate(page, 'copied[0].tree.some(n=>"element" in n)'), false)
      await evaluate(page, `document.querySelector('[aria-label="Close inspector"]').click()`)
      assert.equal(await evaluate(page, 'ctx.pane.devtools'), false)
    } finally {
      page?.close()
      await stopChrome(chrome?.proc)
      await new Promise(r => server.close(r))
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  },
)
