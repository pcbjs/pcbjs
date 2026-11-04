import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { parse, compileScript, compileStyle } from 'vue/compiler-sfc'
import { chromes, launchAny, cdp, evaluate } from '../../../scripts/browser-equality.mjs'

const repo = fileURLToPath(new URL('../../../', import.meta.url)),
  styles = []
const entry = `import {createApp,h,provide,reactive,ref} from 'vue';import EditBar from './packages/ui/src/EditBar.vue';
const node=ref({ref:'R1',at:[10,20,45],m:[1,0,0,1,0,0],caps:['move','rotate']});
const board=reactive({edit:{mode:{mode:'rw'},client:{}},sel:{anchor:'R1'},site:{layers:[]},note:(text)=>window.note=text});
const calls=[],rw=ref(true),tl={node,tools:ref(['move','rotate']),rw,targets:()=>({node:node.value,refs:['R1']}),banner:ref(''),sourceGrid:ref({pitch:1}),snapEnabled:ref(true),snapOverride:ref(null),gridPitch:ref(null),oneShot:(tool,update)=>{calls.push({tool,update});return new Promise((resolve,reject)=>{window.finish=resolve;window.fail=reject})}};
const as={on:ref(false),ends:ref(false),ctx:ref(null)};
window.demo={node,calls,rw};createApp({setup(){provide(Symbol.for('pcbjs:pane'),{board,commands:{run(){}}});return()=>h(EditBar,{tl,as,chip:{x:0,y:0}})}}).mount('#app');`
const built = await build({
  stdin: { contents: entry, resolveDir: repo, sourcefile: 'placement-fields.ts', loader: 'ts' },
  bundle: true,
  platform: 'browser',
  format: 'iife',
  write: false,
  define: { __VUE_OPTIONS_API__: 'true', __VUE_PROD_DEVTOOLS__: 'false', __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false' },
  plugins: [
    {
      name: 'placement-components',
      setup(builder) {
        builder.onLoad({ filter: /\.vue$/ }, args => {
          const { descriptor } = parse(readFileSync(args.path, 'utf8'), { filename: args.path }),
            id = `placement-${styles.length}`
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
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(page, expression) {
  for (let i = 0; i < 80; i++) {
    if (await evaluate(page, expression)) return
    await sleep(25)
  }
  assert.fail(`${expression}: ${page.logs.join('\n')}`)
}
const field = label => `document.querySelector('[aria-label="Placement ${label}"]')`
async function change(page, label, value) {
  await evaluate(
    page,
    `(()=>{const e=${field(label)};e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))})()`,
  )
}

test('placement fields validate, recover refused writes, and cancel typing without blurring selection', { skip: !chromes().length, timeout: 30000 }, async () => {
  const html = `<html><head><style>${readFileSync(join(repo, 'packages/ui/src/style.css'), 'utf8')}\n${styles.join('\n')}html,body,#app{width:100%;height:100%;margin:0}</style></head><body><div id="app" class="pcbjs-ui"></div><script src="/app.js"></script></body></html>`
  const server = createServer((req, res) =>
    res.writeHead(200, { 'content-type': req.url === '/app.js' ? 'text/javascript' : 'text/html' }).end(req.url === '/app.js' ? built.outputFiles[0].text : html),
  )
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const tmp = mkdtempSync(join(tmpdir(), 'pcbjs-placement-fields-'))
  let chrome, page
  try {
    chrome = await launchAny(chromes(), tmp, 0)
    page = await cdp(chrome.socket)
    await page.send('Runtime.enable')
    await page.send('Page.enable')
    await page.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` })
    await until(page, `!!${field('rotation')}`)
    await change(page, 'rotation', '')
    assert.deepEqual(await evaluate(page, `[demo.calls.length,${field('rotation')}.validity.valid]`), [0, false], 'blank rotation never means zero')
    await evaluate(
      page,
      `window.escaped=0;document.addEventListener('keydown',()=>escaped++);${field('rotation')}.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`,
    )
    assert.deepEqual(await evaluate(page, `[${field('rotation')}.value,${field('rotation')}.validity.valid,escaped]`), ['45°', true, 0])
    await change(page, 'X', '100mil')
    await until(page, `${field('X')}.disabled`)
    assert.ok(
      await evaluate(page, `${field('side')}.disabled&&document.querySelector('[aria-label="Editing grid"]').disabled`),
      'other source controls wait for the pending placement',
    )
    assert.deepEqual(await evaluate(page, 'demo.calls[0]'), { tool: 'move', update: { delta: [-7.46, 0], free: true } })
    await evaluate(page, 'finish({written:[],error:"read only"})')
    await until(page, `!${field('X')}.disabled`)
    assert.equal(await evaluate(page, `${field('X')}.value`), '10mm', 'refused placement restores source value')
    await change(page, 'rotation', `${Math.PI}rad`)
    assert.equal(await evaluate(page, 'demo.calls[1].update.angle'), 135)
    await evaluate(page, 'demo.node.value.at=[10,20,180];finish({written:[{applied:true}]})')
    await until(page, `${field('rotation')}.value==='180°'&&!${field('rotation')}.disabled`)
    await change(page, 'Y', '32mm')
    await evaluate(page, 'fail(new Error("Disconnected"))')
    await until(page, `!${field('Y')}.disabled`)
    assert.equal(await evaluate(page, `${field('Y')}.value`), '20mm', 'thrown transport errors restore the source value')
    assert.match(await evaluate(page, 'window.note'), /Disconnected/)
    await change(page, 'X', '50mm')
    await evaluate(page, 'demo.node.value={...demo.node.value,ref:"R2",at:[30,40,0]}')
    await until(page, `${field('X')}.value==='30mm'`)
    await evaluate(page, 'finish({written:[],error:"late refusal"})')
    await until(page, `!${field('X')}.disabled`)
    assert.equal(await evaluate(page, `${field('X')}.value`), '30mm', 'late refusal cannot restore the previous entity')
    await evaluate(page, 'demo.rw.value=false')
    await until(page, `${field('X')}.disabled&&${field('Y')}.disabled&&${field('rotation')}.disabled&&${field('side')}.disabled`)
    await page.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 480, deviceScaleFactor: 1, mobile: false })
    assert.ok(
      await evaluate(page, `(()=>{const r=document.querySelector('.bv-edit').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})()`),
      'placement fields stay inside a narrow pane',
    )
    assert.deepEqual(
      page.logs.filter(line => /error|Hydration/i.test(line)),
      [],
    )
  } finally {
    page?.close()
    chrome?.proc.kill()
    await new Promise(resolve => server.close(resolve))
    rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})
