import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromes, launchAny, stopChrome, cdp, evaluate } from '../../../scripts/browser-equality.mjs'

const compiled = await build({
  stdin: {
    contents: `import * as THREE from 'three';
import { BoardScene } from './packages/ui/src/scene/board-scene.ts';
import { copperSlices, sliceOf, maskThickness } from '@pcbjs/export/internal/scene/stack';
const board={thickness:1.6,copper:2,stackup:{finish:'ENIG',layers:[{type:'mask',side:'F',color:'#008000'},{type:'silk',side:'F',color:'#ffffff'}]}};
const model=new BoardScene({css:(_,f)=>f,cache:new Map(),pool:null,body:()=>new THREE.Group(),changed:()=>{}});
model.makeMaterials(board);
const renderer=new THREE.WebGLRenderer();renderer.setSize(128,128);
const gl=renderer.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info');window.graphics={renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),depth:gl.getParameter(gl.DEPTH_BITS)};
const target=new THREE.WebGLRenderTarget(128,128);renderer.setRenderTarget(target);
const scene=new THREE.Scene();scene.add(new THREE.AmbientLight(0xffffff,3));
const copper=copperSlices(board), mask={F:maskThickness(board,'F'),B:maskThickness(board,'B')};
const camera=new THREE.PerspectiveCamera(35,1,0.1,10000);
window.sample=(side,distance,covered,hideMask=false,state=null,explode=0,blocker=false,hideSilk=false)=>{
 while(scene.children.length>1)scene.remove(scene.children.at(-1));
 const z=sliceOf(side+'.SilkS',copper,mask),sign=side==='F'?1:-1;
 const mz=side==='F'?(covered?copper.get('F.Cu').z1:1.6)+mask.F:(covered?copper.get('B.Cu').z0:0)-mask.B;
 const sz=(side==='F'?z.z1:z.z0)+sign*explode;
 const silk=new THREE.Mesh(new THREE.PlaneGeometry(10,10),state?model.variants.get(model.mats.silk[side],state):model.mats.silk[side]);silk.position.z=sz;silk.rotation.x=side==='F'?0:Math.PI;silk.visible=!hideSilk;scene.add(silk);
 if(blocker){const body=new THREE.Mesh(new THREE.PlaneGeometry(10,10),new THREE.MeshBasicMaterial({color:'#c01010'}));body.position.z=sz+sign*.2;body.rotation.x=silk.rotation.x;scene.add(body);}
 const skin=new THREE.Mesh(new THREE.PlaneGeometry(12,12),model.mats.mask[side][covered?'copper':'bare']);skin.position.z=mz;skin.rotation.x=silk.rotation.x;skin.renderOrder=1;skin.visible=!hideMask;scene.add(skin);
 camera.near=Math.max(.05,distance/200);camera.far=distance*20;camera.position.set(0,-distance*.7,sign*distance*.7);camera.up.set(0,0,sign);camera.lookAt(0,0,sz);camera.updateProjectionMatrix();
 renderer.render(scene,camera);const pixel=new Uint8Array(4);renderer.readRenderTargetPixels(target,64,64,1,1,pixel);return [...pixel];
};window.ready=true;`,
    resolveDir: fileURLToPath(new URL('../../../', import.meta.url)),
    sourcefile: 'silk-depth-test.js',
  },
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
})

test('mask depth never tints silkscreen from either side at overview and close zoom', { skip: chromes().length ? false : 'no Chromium', timeout: 30000 }, async t => {
  const server = createServer((req, res) => {
    res.setHeader('content-type', req.url === '/app.js' ? 'text/javascript' : 'text/html')
    res.end(req.url === '/app.js' ? compiled.outputFiles[0].text : '<!doctype html><script src="/app.js"></script>')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const dir = mkdtempSync(join(tmpdir(), 'pcbjs-silk-depth-'))
  let chrome, page
  try {
    chrome = await launchAny(chromes(), dir, 0)
    page = await cdp(chrome.socket)
    await page.send('Runtime.enable')
    await page.send('Page.enable')
    await page.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` })
    for (let i = 0; i < 100 && !(await evaluate(page, 'window.ready===true')); i++) await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(await evaluate(page, 'window.ready'), true)
    t.diagnostic(JSON.stringify(await evaluate(page, 'window.graphics')))
    for (const side of ['F', 'B'])
      for (const distance of [15, 150, 600])
        for (const covered of [false, true])
          for (const state of [null, 'rim', 'dim'])
            for (const explode of [0, 2])
              for (const blocker of [false, true]) {
                const args = JSON.stringify([side, distance, covered]).slice(1, -1)
                const actual = await evaluate(page, `sample(${args},false,${JSON.stringify(state)},${explode},${blocker})`)
                assert.deepEqual(
                  actual,
                  await evaluate(page, `sample(${args},true,${JSON.stringify(state)},${explode},${blocker})`),
                  `${side}, distance ${distance}, covered ${covered}, ${state}, explode ${explode}, body ${blocker}`,
                )
                if (blocker)
                  assert.deepEqual(
                    actual,
                    await evaluate(page, `sample(${args},true,${JSON.stringify(state)},${explode},true,true)`),
                    `a body 0.2 mm above ${side} silk still occludes it at distance ${distance}`,
                  )
              }
  } finally {
    page?.close()
    await stopChrome(chrome?.proc)
    await new Promise(resolve => server.close(resolve))
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})
