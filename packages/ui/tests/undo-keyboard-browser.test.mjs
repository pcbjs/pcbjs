import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { facetSet } from '@pcbjs/core/site-facets'
import { fixture } from './fixture-board.mjs'
import { chromes, launchAny, stopChrome, cdp, evaluate } from '../../../scripts/browser-equality.mjs'
const repo = fileURLToPath(new URL('../../../', import.meta.url))
const compiled = await build({
  stdin: {
    contents: `import {createViewer} from './packages/ui/src/shell.ts';import {connect} from './packages/ui/src/connect.ts';import {undoKey} from './packages/ui/src/undo.ts';import {fakeTransport} from './packages/ui/tests/fake-transport.mjs';import {MAJOR,PROTOCOL} from '@pcbjs/core/protocol';const shell=createViewer({boards:${JSON.stringify([facetSet(fixture())])},entries:{Fx:'pcb.tsx'},single:true,path:'/',baseUrl:'/',ide:true});window.shell=shell;window.undoKey=undoKey;const t=fakeTransport();t.closed=fn=>window.closeSession=fn;window.setMode=mode=>t.emit('pcbjs:ide:ready',{mode,major:MAJOR,protocol:PROTOCOL,version:'test',capabilities:[],session:'test'});window.disconnect=connect(shell,t);window.setMode('rw');document.body.tabIndex=0;document.body.focus();window.ready=true;`,
    resolveDir: repo,
    sourcefile: 'undo-keyboard-fixture.ts',
    loader: 'ts',
  },
  bundle: true,
  platform: 'browser',
  format: 'iife',
  write: false,
})
const js = compiled.outputFiles[0].text
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(page, expression) {
  for (let i = 0; i < 60; i++) {
    if (await evaluate(page, expression)) return
    await sleep(30)
  }
  assert.fail(expression + '\n' + page.logs.join('\n'))
}
test(
  'real preview keyboard sends native undo without page history, keeps source ownership and typing guards',
  { skip: chromes().length ? false : 'no Chromium', timeout: 30000 },
  async () => {
    const server = createServer((req, res) => {
      res.setHeader('content-type', req.url === '/app.js' ? 'text/javascript' : 'text/html')
      res.end(
        req.url === '/app.js'
          ? js
          : req.url?.startsWith('/frame')
            ? '<body><input id="field"><script src="/app.js"></script>'
            : '<body><iframe src="/frame?ide=1"></iframe><script>window.posts=[];addEventListener("message",e=>{if(e.data.type==="pcbjs:undo"||e.data.type==="pcbjs:key")posts.push(e.data)})</script>',
      )
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const tmp = mkdtempSync(join(tmpdir(), 'pcbjs-undo-keys-'))
    let chrome, page
    try {
      chrome = await launchAny(chromes(), tmp, 0)
      page = await cdp(chrome.socket)
      await page.send('Runtime.enable')
      await page.send('Page.enable')
      await page.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` })
      await until(page, 'document.querySelector("iframe")?.contentWindow?.ready')
      const f = 'document.querySelector("iframe").contentWindow'
      await evaluate(page, `${f}.document.body.focus()`)
      async function key(redo = false) {
        const mac = await evaluate(page, `${f}.navigator.platform.includes('Mac')`)
        const modifiers = (mac ? 4 : 2) | (redo ? 8 : 0)
        await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: redo ? 'Z' : 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers })
        await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: redo ? 'Z' : 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers })
        await sleep(50)
      }
      await key()
      await until(page, 'posts.length===1')
      assert.deepEqual(await evaluate(page, 'posts[0]'), { type: 'pcbjs:undo', board: 'Fx', files: ['pcb.tsx'], redo: false })
      await key(true)
      assert.equal(await evaluate(page, 'posts[1].redo'), true, 'redo works without a page-local undo step')
      await evaluate(page, `${f}.shell.edit.undoFiles.set(${f}.undoKey('Other'),['/foreign.tsx']);${f}.shell.edit.undoFiles.set(${f}.undoKey('Fx'),['/actual.tsx','/patch.ts']);`)
      await key()
      assert.deepEqual(await evaluate(page, 'posts[2].files'), ['/actual.tsx', '/patch.ts'], 'retain ambiguous multi-file provenance for host refusal')
      assert.equal(await evaluate(page, `${f}.shell.edit.done.length+${f}.shell.edit.undone.length`), 0)
      await evaluate(page, `${f}.document.querySelector('#field').focus()`)
      await key()
      assert.equal(await evaluate(page, 'posts.length'), 3, 'typing undo remains native to input')
      await evaluate(page, `${f}.document.body.focus();${f}.shell.edit.dragging=true`)
      await key()
      assert.equal(await evaluate(page, 'posts.length'), 3, 'drag guard never falls through to generic editor key forwarding')
      await evaluate(page, `${f}.shell.edit.dragging=false;${f}.document.addEventListener('keydown',e=>e.preventDefault(),{capture:true,once:true})`)
      await key()
      assert.equal(await evaluate(page, 'posts.length'), 3, 'already consumed modal event stays consumed')
      await evaluate(
        page,
        `${f}.shell.workspace.info={single:false,scopes:[{slug:'one',root:'/workspace/one'},{slug:'two',root:'/workspace/two'}]};${f}.shell.workspace.scope='one';${f}.shell.edit.undoFiles.set(${f}.undoKey('Fx','/workspace/one'),['/workspace/one/lib.tsx'])`,
      )
      await key()
      assert.deepEqual(await evaluate(page, 'posts[3]'), { type: 'pcbjs:undo', board: 'Fx', project: '/workspace/one', files: ['/workspace/one/lib.tsx'], redo: false })
      await evaluate(page, `${f}.shell.workspace.scope='two'`)
      await key()
      assert.deepEqual(
        await evaluate(page, 'posts[4]'),
        { type: 'pcbjs:undo', board: 'Fx', project: '/workspace/two', files: ['/workspace/two/pcb.tsx'], redo: false },
        'same board name in another project uses its own source entry',
      )
      await evaluate(page, `${f}.setMode('ro')`)
      const beforeReadonly = await evaluate(page, 'posts.length')
      await key()
      assert.equal(await evaluate(page, 'posts.length'), beforeReadonly, 'read-only undo cannot fall through to host keyboard forwarding')
      await evaluate(page, `${f}.setMode('rw')`)
      assert.equal(await evaluate(page, `${f}.shell.edit.mode.mode`), 'rw', 'permission comes from the session ready response')
      await evaluate(page, `${f}.closeSession()`)
      assert.equal(await evaluate(page, `${f}.shell.edit.mode.mode`), 'ro')
      assert.equal(await evaluate(page, `${f}.shell.edit.client`), null)
      await key()
      assert.equal(await evaluate(page, 'posts.length'), beforeReadonly, 'disconnection revokes undo access')
    } finally {
      page?.close()
      await stopChrome(chrome?.proc)
      await new Promise(resolve => server.close(resolve))
      rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  },
)
