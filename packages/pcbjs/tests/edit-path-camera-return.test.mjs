import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NO_RASTER } from './view-perf.mjs'
import { harness, skip, ev, ed, page, S, until, viewSettled, key } from './edit-path-harness.mjs'

harness()
const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]))
const pose = `(()=>{const c=window.__pcbjs3d.camera;return {p:c.position.toArray(),q:c.quaternion.toArray(),zoom:c.zoom}})()`

test('3D component isolation animates out as well as in and returns to the original camera', { skip }, async () => {
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: NO_RASTER })
  await ev('window.__beforeReload = true')
  await page.send('Page.navigate', { url: new URL('board/Blinky?view=3d', S.dev.url).href })
  await until('3D ready', () => ev(`!window.__beforeReload && document.documentElement.dataset.ready === '3d' && !!window.__pcbjs3d`).catch(() => false), 30000)
  await viewSettled()
  const base = await ev(pose)
  await ed.link.request('session/select', { board: 'Blinky', refs: ['J1'], anchor: 'J1' })
  await until('component selected', () => ev(`document.querySelector('.chip.path')?.textContent.includes('J1')`))
  await key('i', 'KeyI')
  await until('component isolated', () => ev(`!!document.querySelector('.layout-state')`))
  await viewSettled()
  const focused = await ev(pose)
  assert.ok(distance(base.p, focused.p) > 1)
  await ev(
    `window.__cameraFrames=[];window.addEventListener('keydown', function sampleEscape(e) {
      if (e.key !== 'Escape') return
      window.removeEventListener('keydown', sampleEscape, true)
      const base = ${JSON.stringify(base)}, end = performance.now() + 45000
      const sample = () => {
        const p = ${pose}; window.__cameraFrames.push(p)
        if (Math.hypot(...p.p.map((v,i)=>v-base.p[i])) < 1e-7 || performance.now() > end) window.__cameraSampled=true
        else requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    }, true)`,
  )
  await key('Escape', 'Escape')
  await until('blur sampled', () => ev('window.__cameraSampled === true'), 60000)
  const frames = await ev('window.__cameraFrames')
  assert.ok(
    frames.filter(f => distance(f.p, base.p) > 0.01 && distance(f.p, focused.p) > 0.01).length > 3,
    `several intermediate camera positions render during blur: ${JSON.stringify(frames)}`,
  )
  const end = await ev(pose)
  assert.ok(distance(end.p, base.p) < 1e-7, 'saved position is restored exactly')
  assert.ok(Math.abs(Math.abs(end.q.reduce((n, v, i) => n + v * base.q[i], 0)) - 1) < 1e-10, 'saved orbit orientation returns')
  assert.equal(end.zoom, base.zoom)
  assert.equal(await ev(`!!document.querySelector('.layout-state')`), false)
})
