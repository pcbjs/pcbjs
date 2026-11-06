import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { parse, compileScript, compileStyle } from 'vue/compiler-sfc'
import { fixture } from './fixture-board.mjs'
import { chromes, launchAny, stopChrome, cdp, evaluate } from '../../../scripts/browser-equality.mjs'

const repo = fileURLToPath(new URL('../../../', import.meta.url))
const drawing = {
  grid: 1,
  page: [0, 0, 40, 30],
  symbols: [
    {
      ref: 'R1',
      value: '1k',
      kind: 'resistor',
      at: [15, 15],
      rot: 0,
      flip: false,
      m: [1, 0, 0, 1, 15, 15],
      body: [],
      box: [14, 13, 16, 17],
      pins: [],
      names: false,
      refAt: [17, 14],
      valueAt: [17, 16],
      auto: false,
      path: [],
      items: [],
    },
  ],
  wires: [],
  labels: [],
  junctions: [],
  noConnects: [],
  texts: [],
  sheets: [],
}
const base = fixture()
const site = {
  ...base,
  viewBox: [-5, -5, 40, 30],
  bbox: { x: 0, y: 0, w: 30, h: 20 },
  footprints: base.footprints.map(fp => ({ ...fp, body: { x: fp.at[0], y: fp.at[1], w: 2, h: 2, rot: 0 } })),
  outline: [
    [
      [0, 0],
      [30, 0],
      [30, 20],
      [0, 20],
    ],
  ],
  holes: '',
  drills: [],
  ratsnest: [],
  copper: 2,
  thickness: 1.6,
  drc: [
    {
      id: 'drc:clearance:aaaaaaaaaaaa',
      fingerprint: 'aaaaaaaaaaaa',
      kind: 'drc',
      rule: 'clearance',
      severity: 'error',
      message: 'Details stay out of the canvas',
      at: [15, 10],
      refs: ['R1'],
      items: [],
      mark: { at: [15, 10], layer: 'F.Cu', side: 'F' },
    },
    {
      id: 'drc:unconnected:bbbbbbbbbbbb',
      kind: 'drc',
      rule: 'unconnected',
      severity: 'error',
      message: 'Details',
      refs: ['net:B'],
      items: [],
      at: [15, 10],
      mark: {
        line: [
          [10, 10],
          [20, 10],
        ],
        rats: null,
        layer: 'F.Cu',
      },
    },
  ],
  erc: [
    { id: 'erc:sch-dangling:cccccccccccc', kind: 'erc', rule: 'sch-dangling', severity: 'error', message: 'Details', layer: 'sch', at: [15, 15], refs: [], items: [], mark: null },
  ],
  schematic: { ...base.schematic, drawing, svg: { style: '', markup: '<g data-kind="sym" data-ref="R1"><rect x="14" y="13" width="2" height="4"/></g>' } },
}
const styles = []
let scopeId = 0
const compiled = await build({
  stdin: {
    resolveDir: repo,
    sourcefile: 'touch-browser-entry.js',
    contents: `
    import {createApp,h,provide,reactive,effectScope} from 'vue';
    import Board2D from './packages/ui/src/Board2D.vue';
    import BoardSch from './packages/ui/src/BoardSch.vue';
    import Board3D from './packages/ui/src/Board3D.vue';
    import {createBoard} from './packages/ui/src/board-store.ts';
    import {createPane,paneEffects} from './packages/ui/src/pane.ts';
    import {commandBus} from './packages/ui/src/keys.ts';
    import {configure} from './packages/ui/src/env.ts';configure({dev:true});
    const store=createBoard('Fx');store.targets.push(${JSON.stringify(site)});
    const contexts=Object.fromEntries(['2d','sch','3d'].map(mode=>{
      const pane=createPane(mode);pane.tab='drc';effectScope(true).run(()=>paneEffects(store,pane));
      return [mode,{board:store,pane,prefs:reactive({grid:false,ratsnest:false,deep:false,theme:'dark'}),commands:commandBus(),shell:null,theme:()=> 'dark',toggle(){},say(){},open:async()=>{}}];
    }));
    const state=reactive({mode:'2d',mounted:true,clicks:0});window.demo={state,store,contexts};
    window.touchTrace=[];for(const type of ['pointerdown','pointermove','pointerup','pointercancel'])window.addEventListener(type,e=>{if(e.pointerType==='touch')window.touchTrace.push([type,e.pointerId,e.clientX,e.clientY])},true);
    const Host={props:['mode'],setup(p){provide(Symbol.for('pcbjs:pane'),contexts[p.mode]);return()=>h({'2d':Board2D,sch:BoardSch,'3d':Board3D}[p.mode])}};
    window.errors=[];const app=createApp({render:()=>[state.mounted?h(Host,{key:state.mode,mode:state.mode}):null,h('button',{class:'outer-control',style:'position:absolute;left:15px;bottom:55px;z-index:10',onClick:()=>state.clicks++},'Pane control')]});app.config.errorHandler=e=>{window.errors.push(e.stack);console.error(e.stack)};app.mount('#app');
  `,
  },
  bundle: true,
  platform: 'browser',
  format: 'iife',
  write: false,
  loader: { '.svg': 'text' },
  plugins: [
    {
      name: 'vue',
      setup(builder) {
        builder.onResolve({ filter: /\?worker&inline$/ }, args => ({ path: resolve(args.resolveDir, args.path.split('?')[0]), namespace: 'worker' }))
        builder.onLoad({ filter: /.*/, namespace: 'worker' }, async args => {
          const worker = await build({ entryPoints: [args.path], bundle: true, platform: 'browser', format: 'iife', write: false })
          return {
            contents: `const url=URL.createObjectURL(new Blob([${JSON.stringify(worker.outputFiles[0].text)}],{type:'text/javascript'}));export default class extends Worker{constructor(){super(url)}}`,
            loader: 'js',
          }
        })
        builder.onLoad({ filter: /\.vue$/ }, args => {
          const { descriptor } = parse(readFileSync(args.path, 'utf8'), { filename: args.path })
          const id = `touch-${scopeId++}`
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
  for (let i = 0; i < 150; i++) {
    if (await evaluate(page, expression)) return
    await sleep(40)
  }
  assert.fail(`Not observed: ${expression}\n${page.logs.join('\n')}\n${await evaluate(page, 'window.errors')} mode=${await evaluate(page, 'window.demo?.state.mode')}`)
}
const canvas = { '2d': '.board-svg', sch: '.sch-svg', '3d': '.view3d-canvas' }
const state = (page, mode) =>
  evaluate(page, mode === '3d' ? 'window.__pcbjs3d.camera.position.toArray()' : `document.querySelector('${canvas[mode]}').getAttribute('viewBox').split(' ').map(Number)`)
async function settledViewBox(page, mode) {
  await evaluate(
    page,
    `new Promise((resolve,reject)=>{
    let previous=null,stable=0;const start=performance.now();
    const frame=()=>{const value=document.querySelector('${canvas[mode]}').getAttribute('viewBox').split(' ').map(Number);
      stable=previous&&value.every((v,i)=>v===previous[i])?stable+1:0;previous=value;
      if(stable===3)return resolve();if(performance.now()-start>5000)return reject(new Error('viewBox did not settle: '+JSON.stringify(value)));
      requestAnimationFrame(frame);
    };requestAnimationFrame(frame);
  })`,
  )
}
const touch = (page, type, points) => page.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id, radiusX: 2, radiusY: 2, force: 1 })) })
async function point(page, selector) {
  return evaluate(page, `(()=>{const el=document.querySelector(${JSON.stringify(selector)}),r=el.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`)
}
async function pinch(page, from, cancel = false) {
  await evaluate(page, 'window.touchTrace=[]')
  const second = [from[0] < 240 ? from[0] + 95 : from[0] - 95, Math.min(420, from[1] + 95)]
  await touch(page, 'touchStart', [from])
  await touch(page, 'touchStart', [from, second])
  for (let i = 1; i <= 5; i++) await touch(page, 'touchMove', [from, [second[0] + (second[0] > from[0] ? 8 : -8) * i, second[1] + 6 * i]])
  const last = [second[0] + (second[0] > from[0] ? 40 : -40), second[1] + 30]
  await until(
    page,
    `(()=>{const down=window.touchTrace.filter(e=>e[0]==='pointerdown'),move=window.touchTrace.findLast(e=>e[0]==='pointermove'&&e[1]===down[1]?.[1]);return move&&Math.abs(move[2]-${last[0]})<1e-4&&Math.abs(move[3]-${last[1]})<1e-4})()`,
  )
  const trace = await evaluate(page, 'window.touchTrace')
  const down = trace.filter(e => e[0] === 'pointerdown')
  const end = trace.findLast(e => e[0] === 'pointermove' && e[1] === down[1][1])
  for (const [event, expected] of [
    [down[0], from],
    [down[1], second],
    [end, last],
  ])
    assert.ok(
      expected.every((v, axis) => Math.abs(event[axis + 2] - v) < 1e-4),
      `delivered touch ${JSON.stringify(event)} matches ${expected}`,
    )
  await touch(page, cancel ? 'touchCancel' : 'touchEnd', [])
  await sleep(150)
  return { from: [(down[0][2] + down[1][2]) / 2, (down[0][3] + down[1][3]) / 2], to: [(down[0][2] + end[2]) / 2, (down[0][3] + end[3]) / 2] }
}

test('mobile pinch owns the canvas, controls and DRC labels in every preview', { skip: chromes().length ? false : 'no Chromium', timeout: 60000 }, async () => {
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${readFileSync(resolve(repo, 'packages/ui/src/style.css'), 'utf8')}\n${styles.join('\n')}\nhtml,body{margin:0}#app{position:relative;width:480px;height:540px}</style></head><body><div id="app" class="pcbjs-ui pcbjs-view" data-theme="dark"></div><p id="outside">Outside preview</p><script src="/app.js"></script></body></html>`
  const server = createServer((req, res) =>
    res.writeHead(200, { 'content-type': req.url === '/app.js' ? 'text/javascript' : 'text/html' }).end(req.url === '/app.js' ? compiled.outputFiles[0].text : html),
  )
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const dir = mkdtempSync(join(tmpdir(), 'pcbjs-touch-browser-'))
  let chrome, page
  try {
    chrome = await launchAny(chromes(), dir, 0)
    page = await cdp(chrome.socket)
    await page.send('Runtime.enable')
    await page.send('Page.enable')
    await page.send('Emulation.setDeviceMetricsOverride', { width: 480, height: 640, deviceScaleFactor: 1, mobile: true })
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
    await page.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` })
    await until(page, '!!window.demo')
    for (const mode of ['2d', 'sch', '3d']) {
      await evaluate(page, `window.demo.state.mode='${mode}'`)
      await until(page, `!!document.querySelector('${canvas[mode]}')`)
      if (mode === '3d') await until(page, `!!window.__pcbjs3d&&!!document.querySelector('.view3d-note .lbl')`)
      await sleep(600)
      if (mode === '2d')
        await evaluate(
          page,
          `(()=>{const svg=document.querySelector('.board-svg'),b=svg.viewBox.baseVal,r=document.createElementNS('http://www.w3.org/2000/svg','rect');r.dataset.id='11';r.dataset.kind='zone';r.dataset.net='GND';for(const [key,value] of Object.entries({x:b.x,y:b.y,width:b.width,height:b.height}))r.setAttribute(key,value);const g=document.createElementNS('http://www.w3.org/2000/svg','g');g.classList.add('layer');g.dataset.testHover='';g.append(r);svg.append(g)})()`,
        )
      let hovered = false
      if (mode === 'sch') {
        const at = await evaluate(
          page,
          `(()=>{const svg=document.querySelector('.sch-svg'),p=svg.createSVGPoint();p.x=15;p.y=15;const at=p.matrixTransform(svg.getScreenCTM());return [at.x,at.y]})()`,
        )
        await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at[0], y: at[1] })
        await sleep(80)
        hovered = await evaluate(page, '!!window.demo.store.hover.item')
      }
      for (let y = 120; y < 430 && !hovered; y += 40)
        for (let x = 80; x < 430 && !hovered; x += 40) {
          await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
          await sleep(25)
          hovered = await evaluate(page, '!!window.demo.store.hover.item')
        }
      assert.ok(hovered, `${mode} has a hovered entity before leaving`)
      if (mode === '2d') await evaluate(page, `document.querySelector('.board-svg g[data-test-hover]').remove()`)
      await evaluate(page, `document.dispatchEvent(new PointerEvent('pointerout',{relatedTarget:null}))`)
      await sleep(40)
      assert.equal(await evaluate(page, 'window.demo.store.hover.item'), null, `${mode} browsing context exit clears hover`)
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 490, y: 550 })
      await sleep(60)
      assert.equal(await evaluate(page, 'window.demo.store.hover.item'), null, `${mode} viewport exit clears entity hover`)
      assert.equal(await evaluate(page, "document.querySelectorAll('.view-bubble').length"), 0, `${mode} viewport exit clears tooltips`)
      const pageScale = await evaluate(page, 'visualViewport.scale')
      const targets = [canvas[mode], mode === '3d' ? '.view3d-buttons button' : '.bv-tools button']
      if (mode === '3d') targets.push('.view3d-note .lbl')
      if (mode === '2d') targets.push('.board-svg .drc path')
      if (mode === 'sch') targets.push('.sch-svg .drc circle')
      targets.push('.outer-control')
      for (const target of targets) {
        await evaluate(page, `document.querySelector('${mode === '3d' ? '.view3d-buttons button' : '.bv-tools button'}').click()`)
        if (mode === '3d') await sleep(500)
        else await settledViewBox(page, mode)
        await until(page, `!!document.querySelector(${JSON.stringify(target)})`)
        const before = await state(page, mode)
        const anchor = await evaluate(page, 'window.demo.store.sel.anchor')
        const from = await point(page, target)
        assert.ok(from[0] > 0 && from[0] < 480 && from[1] > 0 && from[1] < 540, `${mode} target in viewport: ${target} ${from}`)
        if (target.includes('drc') || target.includes('.lbl')) {
          await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from[0], y: from[1] })
          await sleep(50)
          await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 490, y: 550 })
          await sleep(50)
          assert.equal(await evaluate(page, "document.querySelectorAll('.view-bubble').length"), 0, `${mode} finding tooltip clears on exit`)
        }
        const gesture = await pinch(page, from)
        const after = await state(page, mode)
        assert.notDeepEqual(after, before, `${mode} zooms when starting on ${target}`)
        if (mode !== '3d') {
          assert.ok(after[2] < before[2], `${mode} spread zooms in`)
          const rect = await evaluate(page, `(()=>{const r=document.querySelector('${canvas[mode]}').getBoundingClientRect();return [r.x,r.y,r.width,r.height]})()`)
          for (let axis = 0; axis < 2; axis++) {
            const start = before[axis] + ((gesture.from[axis] - rect[axis]) * before[axis + 2]) / rect[axis + 2]
            const end = after[axis] + ((gesture.to[axis] - rect[axis]) * after[axis + 2]) / rect[axis + 2]
            assert.ok(
              Math.abs(start - end) < 0.02,
              `${mode} keeps the midpoint anchored: ${JSON.stringify({ target, axis, start, end, before, after, gesture, rect, trace: await evaluate(page, 'window.touchTrace') })}`,
            )
          }
        }
        assert.equal(await evaluate(page, 'visualViewport.scale'), pageScale, `${mode} does not zoom the page`)
        assert.equal(await evaluate(page, 'window.demo.store.sel.anchor'), anchor, `${mode} pinch does not select an entity or finding`)
      }
      if (mode !== '3d') {
        const zoomed = await state(page, mode)
        await evaluate(page, `document.querySelector('.bv-tools button').click()`)
        await evaluate(page, 'new Promise(resolve=>requestAnimationFrame(resolve))')
        assert.notDeepEqual(await state(page, mode), zoomed, `${mode} starts an animated fit`)
        await touch(page, 'touchStart', [[180, 220]])
        await touch(page, 'touchStart', [
          [180, 220],
          [280, 220],
        ])
        const owned = await state(page, mode)
        await sleep(150)
        assert.deepEqual(await state(page, mode), owned, `${mode} pinch start cancels the running fit animation`)
        await touch(page, 'touchEnd', [])
      }
      assert.equal(await evaluate(page, 'window.demo.state.clicks'), 0, 'pinching on a sibling control does not click it')
      const control = await point(page, '.outer-control')
      await touch(page, 'touchStart', [control])
      await touch(page, 'touchEnd', [])
      await sleep(80)
      assert.equal(await evaluate(page, 'window.demo.state.clicks'), 1, 'a later single tap still activates controls')
      await evaluate(page, 'window.demo.state.clicks=0')
      await touch(page, 'touchStart', [
        [180, 220],
        [280, 220],
      ])
      await touch(page, 'touchMove', [
        [160, 220],
        [300, 220],
      ])
      await touch(page, 'touchEnd', [[160, 220]])
      await sleep(80)
      const oneFinger = await state(page, mode)
      await touch(page, 'touchMove', [[160, 260]])
      await sleep(80)
      const remaining = await state(page, mode)
      assert.ok(
        remaining.every((value, i) => Math.abs(value - oneFinger[i]) < 1e-8),
        `${mode} remaining finger cannot drag after pinch`,
      )
      await touch(page, 'touchEnd', [])
      await evaluate(
        page,
        `(()=>{const list=document.createElement('div');list.id='scroll-menu';list.style='position:absolute;right:20px;bottom:80px;width:80px;height:90px;overflow:auto;z-index:20;background:#333';list.innerHTML='<div style="height:400px">Menu choices</div>';document.querySelector('#app').append(list)})()`,
      )
      const menu = await point(page, '#scroll-menu')
      await touch(page, 'touchStart', [[menu[0], menu[1] + 25]])
      for (let i = 1; i <= 6; i++) await touch(page, 'touchMove', [[menu[0], menu[1] + 25 - i * 8]])
      await touch(page, 'touchEnd', [])
      await until(page, "document.querySelector('#scroll-menu').scrollTop>0")
      await evaluate(page, "document.querySelector('#scroll-menu').remove()")
      const beforeCancel = await state(page, mode)
      await pinch(page, [200, 230], true)
      assert.notDeepEqual(await state(page, mode), beforeCancel)
      const afterCancel = await state(page, mode)
      await pinch(page, [210, 240])
      assert.notDeepEqual(await state(page, mode), afterCancel, `${mode} recovers after pointer cancellation`)
      if (mode !== 'sch') {
        await evaluate(
          page,
          `(()=>{
          const b=window.demo.store;b.targets[0].dev={snapshot:'touch-edit'};
          window.commits=0;b.edit.mode={mode:'rw',editor:true};
          b.edit.client={begin:async()=>({txn:'touch',tools:[]}),update:async()=>({files:[],notes:[]}),commit:async()=>{window.commits++;return {written:[]}},cancel:async()=>null};
          b.edit.assist={board:'Fx',command:'at',relative:false,ref:'R1',start:[15,10],pad:null,layer:'F.Cu',net:null,side:'F',grid:null,width:0.2,typed:[],open:true};
        })()`,
        )
        await sleep(100)
        await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 200, y: 230 })
        await sleep(50)
        await touch(page, 'touchStart', [[200, 230]])
        await sleep(50)
        assert.equal(await evaluate(page, 'window.commits'), 0, `${mode} touch down cannot commit an assist before a possible pinch`)
        await touch(page, 'touchStart', [
          [200, 230],
          [300, 230],
        ])
        await touch(page, 'touchMove', [
          [180, 230],
          [320, 230],
        ])
        await touch(page, 'touchEnd', [])
        await sleep(100)
        assert.equal(await evaluate(page, 'window.commits'), 0, `${mode} pinch cannot commit an assist`)
        await evaluate(page, `document.querySelector('${mode === '3d' ? '.view3d-buttons button' : '.bv-tools button'}').click()`)
        await sleep(500)
        const at = await evaluate(
          page,
          mode === '3d'
            ? `(()=>{const c=window.__pcbjs3d.camera,v=c.position.clone().set(5,-16,window.__pcbjs3d.pcb.faceZ('F.Cu')).applyMatrix4(window.__pcbjs3d.pcb.root.matrixWorld).project(c),r=document.querySelector('.view3d-canvas').getBoundingClientRect();return [r.x+(v.x+1)*r.width/2,r.y+(1-v.y)*r.height/2]})()`
            : `(()=>{const svg=document.querySelector('.board-svg'),p=svg.createSVGPoint();p.x=5;p.y=16;const at=p.matrixTransform(svg.getScreenCTM());return [at.x,at.y]})()`,
        )
        const target = await evaluate(page, `document.elementFromPoint(${at[0]},${at[1]})?.outerHTML.slice(0,300)`)
        assert.ok(mode !== '3d' || target.includes('<canvas'), `${mode} assist target ${at}: ${target}`)
        await touch(page, 'touchStart', [at])
        await touch(page, 'touchEnd', [])
        await until(page, 'window.commits===1')
        await evaluate(page, 'window.demo.store.edit.assist=null;window.demo.store.edit.client=null;window.demo.store.edit.mode=null')
      }
      if (mode === '2d') {
        await evaluate(
          page,
          `(()=>{
          const b=window.demo.store;b.targets[0].dev={snapshot:'drag-edit'};
          b.targets[0].edit=[{ref:'R1',caps:['placed','layered'],at:[1,5,0],side:'F',m:[1,0,0,1,0,0],grid:null,src:{at:{file:'pcb.tsx',line:1,col:1}}}];
          b.run=1;b.selectRef('R1');b.edit.tool='move';b.edit.mode={mode:'rw',editor:true};window.dragCommits=0;window.dragCancels=0;
          b.edit.client={begin:async()=>({txn:'drag',tools:[]}),update:async()=>({files:[],notes:[]}),commit:async()=>{window.dragCommits++;return {written:[]}},cancel:async()=>{window.dragCancels++;return null}};
          const svg=document.querySelector('.board-svg'),v=svg.viewBox.baseVal,g=document.createElementNS('http://www.w3.org/2000/svg','g'),r=document.createElementNS('http://www.w3.org/2000/svg','rect');g.classList.add('layer');g.dataset.dragTest='';r.dataset.id='1';r.dataset.ref='R1';r.dataset.kind='pad';for(const [k,value]of Object.entries({x:v.x,y:v.y,width:v.width,height:v.height}))r.setAttribute(k,value);g.append(r);svg.append(g);
        })()`,
        )
        await sleep(80)
        for (const interrupted of [true, false]) {
          await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 200, y: 230 })
          await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 200, y: 230, button: 'left', buttons: 1, clickCount: 1 })
          await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 240, y: 250, buttons: 1 })
          await until(page, 'window.demo.store.edit.dragging')
          if (interrupted) {
            await evaluate(page, "window.dispatchEvent(new Event('blur'))")
            await until(page, '!window.demo.store.edit.dragging&&window.dragCancels===1')
            assert.equal(await evaluate(page, 'window.dragCommits'), 0, 'interrupted edit drag never commits')
          }
          await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 240, y: 250, button: 'left', buttons: 0, clickCount: 1 })
          if (!interrupted) await until(page, 'window.dragCommits===1&&!window.demo.store.edit.dragging')
        }
        assert.equal(await evaluate(page, 'window.dragCommits'), 1, 'fresh edit drag commits exactly once after cancellation')
        await evaluate(
          page,
          "document.querySelector('[data-drag-test]').remove();window.demo.store.edit.client=null;window.demo.store.edit.mode=null;window.demo.store.selectRef(null)",
        )
      }
      for (const reason of ['pointercancel', 'lostpointercapture', 'blur', 'buttons']) {
        await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 200, y: 230 })
        await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 200, y: 230, button: 'left', buttons: 1, clickCount: 1 })
        await evaluate(
          page,
          `(()=>{const el=document.querySelector('${canvas[mode]}');for(const [pointerId,button] of [[92,0],[1,2]])el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId,pointerType:'mouse',button,buttons:3,clientX:205,clientY:230}))})()`,
        )
        await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 225, y: 230, buttons: 1 })
        await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 490, y: 550, buttons: 1 })
        await sleep(40)
        assert.equal(await evaluate(page, 'window.demo.store.hover.item'), null, `${mode} captured boundary exit clears hover`)
        assert.equal(await evaluate(page, "document.querySelectorAll('.view-bubble').length"), 0, `${mode} captured boundary exit clears tooltip`)
        await evaluate(
          page,
          `(()=>{
          const el=document.querySelector('${canvas[mode]}');
          const event=(type,x,buttons)=>el.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:1,pointerType:'mouse',button:0,buttons,clientX:x,clientY:230}));
          if ('${reason}'==='blur') window.dispatchEvent(new Event('blur'));
          else if ('${reason}'==='buttons') event('pointermove',225,0);
          else event('${reason}',225,0);
        })()`,
        )
        await sleep(300)
        const stopped = await state(page, mode)
        const anchor = await evaluate(page, 'window.demo.store.sel.anchor')
        await evaluate(
          page,
          `(()=>{const el=document.querySelector('${canvas[mode]}');for(const [type,x] of [['pointermove',260],['pointerup',260]])el.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:1,pointerType:'mouse',button:0,buttons:0,clientX:x,clientY:230}))})()`,
        )
        await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 260, y: 230, button: 'left', buttons: 0, clickCount: 1 })
        await sleep(150)
        const after = await state(page, mode)
        assert.ok(
          after.every((v, i) => Math.abs(v - stopped[i]) < 1e-8),
          `${mode} ${reason} ends the drag`,
        )
        assert.equal(await evaluate(page, 'window.demo.store.sel.anchor'), anchor, `${mode} ${reason} cannot become a click`)
      }
      await evaluate(page, 'window.demo.state.mounted=false')
      await until(page, `!document.querySelector('${canvas[mode]}')`)
      await evaluate(page, 'window.demo.state.mounted=true')
      await until(page, `!!document.querySelector('${canvas[mode]}')`)
    }
    assert.equal(await evaluate(page, `getComputedStyle(document.querySelector('#outside')).touchAction`), 'auto', 'page outside the preview keeps native gestures')
    assert.deepEqual(await evaluate(page, 'window.errors'), [])
    assert.deepEqual(
      page.logs.filter(line => /Uncaught|TypeError|ReferenceError/.test(line)),
      [],
    )
  } finally {
    page?.close()
    await stopChrome(chrome?.proc)
    await new Promise(resolve => server.close(resolve))
    rmSync(dir, { recursive: true, force: true })
  }
})
