import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromes, launchAny, stopChrome, cdp, evaluate } from '../../../scripts/browser-equality.mjs'

const repo = fileURLToPath(new URL('../../../', import.meta.url))
const compiled = await build({
  stdin: {
    contents: `import {Paint2d} from './packages/ui/src/paint2d.ts';const root=document.querySelector('#content');window.painter=new Paint2d(()=>root);const empty={ids:new Set(),parts:new Set(),nets:new Set()};window.paint={fade:true,iso:null,stale:{ids:new Set(),gone:new Set()},sel:{...empty,ids:new Set([1,2])},anchor:empty,ctx:empty};painter.apply(paint,'first');window.ready=true;`,
    resolveDir: repo,
    sourcefile: 'paint2d-test.js',
  },
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
})
const markup = `<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg"><style>.lifted{display:none}</style><g id="content"><g class="layer" data-layer="F.Cu"><rect width="100" height="100" fill="#ffffff"/><g><rect data-id="1" x="30" y="30" width="20" height="20" fill="#ff0000"/></g></g><g class="layer" data-layer="B.Cu"><rect data-id="2" x="40" y="40" width="20" height="20" fill="#0000ff"/></g><g class="grid"><circle cx="35" cy="35" r="3" fill="#888888"/><circle cx="70" cy="70" r="3" fill="#888888"/></g><g class="layer lit" data-layer="F.Cu"></g><g class="layer lit" data-layer="B.Cu"></g></g></svg>`
test(
  'separate lit passes preserve layer order and leave the grid above pours but below focused copper',
  { skip: chromes().length ? false : 'no Chromium', timeout: 30000 },
  async () => {
    const server = createServer((req, res) => {
      res.setHeader('content-type', req.url === '/app.js' ? 'text/javascript' : 'text/html')
      res.end(req.url === '/app.js' ? compiled.outputFiles[0].text : `<!doctype html>${markup}<script src="/app.js"></script>`)
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const dir = mkdtempSync(join(tmpdir(), 'pcbjs-paint2d-'))
    let chrome, page
    try {
      chrome = await launchAny(chromes(), dir, 0)
      page = await cdp(chrome.socket)
      await page.send('Runtime.enable')
      await page.send('Page.enable')
      await page.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` })
      for (let i = 0; i < 100 && !(await evaluate(page, 'window.ready===true')); i++) await new Promise(resolve => setTimeout(resolve, 20))
      assert.equal(await evaluate(page, 'window.ready'), true)
      assert.deepEqual(await evaluate(page, `[...document.querySelectorAll('.lit')].map(g=>[g.dataset.layer,[...g.children].map(e=>e.dataset.id)])`), [
        ['F.Cu', ['1']],
        ['B.Cu', ['2']],
      ])
      assert.equal(await evaluate(page, `document.querySelectorAll('.layer:not(.lit) .lifted').length`), 2)
      const pixels = await evaluate(
        page,
        `window.sample = () => new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>{const c=document.createElement('canvas');c.width=c.height=100;const ctx=c.getContext('2d');ctx.drawImage(image,0,0);resolve([[70,70],[35,35],[45,45]].map(([x,y])=>[...ctx.getImageData(x,y,1,1).data]));};image.onerror=reject;image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(new XMLSerializer().serializeToString(document.querySelector('svg')));});window.sample()`,
      )
      assert.deepEqual(
        pixels,
        [
          [136, 136, 136, 255],
          [255, 0, 0, 255],
          [0, 0, 255, 255],
        ],
        'quiet grid survives opaque pour; focused copper covers grid; later lit layer stays above earlier one',
      )
      assert.equal(await evaluate(page, 'painter.posed(new Set(),new Set([1,2]),new Set(),"first").length'), 4)
      await evaluate(page, 'painter.apply({...paint,fade:false},"first")')
      assert.equal(await evaluate(page, `document.querySelectorAll('.lit > *').length`), 2, 'turning fade off keeps focused copper above the grid')
      assert.deepEqual(await evaluate(page, 'window.sample()'), pixels, 'fade off preserves grid beneath focused copper')
      await evaluate(page, 'painter.apply({...paint,fade:false,sel:{ids:new Set(),parts:new Set(),nets:new Set()}},"first")')
      assert.equal(await evaluate(page, `document.querySelectorAll('.lit > *, .lifted').length`), 0, 'clearing selection restores originals and removes copies')
      assert.deepEqual(
        await evaluate(page, 'window.sample()'),
        [
          [136, 136, 136, 255],
          [136, 136, 136, 255],
          [0, 0, 255, 255],
        ],
        'selection clear returns ordinary artwork below the grid',
      )
      await evaluate(page, 'painter.apply(paint,"second")')
      assert.equal(await evaluate(page, `document.querySelectorAll('.lit > *').length`), 2, 'facet refresh rebuilds explicit layer destinations')
    } finally {
      page?.close()
      await stopChrome(chrome?.proc)
      await new Promise(resolve => server.close(resolve))
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  },
)
