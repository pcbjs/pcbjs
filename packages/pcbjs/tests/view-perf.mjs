// The preview's frame budgets on usb3-hub, measured end to end: a real `pcbjs session serve` on a scratch copy of the example and the viewer
// in a headless Chromium driven through DevTools input events. Each probe times the main thread's work of a frame, from the event or the
// frame's start to the end of its rendering, in the page itself; see docs/bench.md. Used by view-perf.test.mjs and scripts/bench.mjs.
import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { cpus, loadavg, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromes, launchAny, cdp, evaluate } from '../../../scripts/browser-equality.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const BIN = join(REPO, 'packages', 'pcbjs', 'bin', 'pcbjs.js')
const EXAMPLE = join(REPO, 'examples', 'usb3-hub')
const sleep = ms => new Promise(r => setTimeout(r, ms))
export const viewSkip = () => (process.platform === 'win32' ? 'the view bench runs on Linux and macOS' : chromes().length ? false : 'no Chromium found; set PCBJS_CHROME to one')

/** A measurement counted in frames from the pointer event to the frame that shows it, 1 the next one; every other one is ms. */
export const inFrames = key => /^(hover|dragFirst)/.test(key)
/** A measurement counted in draw calls of the 3D scene pass: `calls3d` at rest, `callsFade3d` with a part selected under the fade. */
export const inCalls = key => key.startsWith('calls')

/** The load per core: the one-minute load average over the CPU count. */
export const loadPerCore = () => loadavg()[0] / cpus().length

/** The measurements over budget by more than the margin: a quarter, and as much again per unit of load per core above a half; a frame count one frame more only under load; a draw count none. `load` is the run's own, the highest it sampled, else now. */
export function overBudget(out, budgets, load = out.load ?? loadPerCore()) {
  const k = 1.25 + Math.max(0, load - 0.5)
  return Object.entries(budgets).flatMap(([key, b]) => {
    const v = out[key]
    if (v === undefined) return [`${key} not measured`]
    const limit = inCalls(key) ? b : inFrames(key) ? b + (load > 0.75 ? 1 : 0) : +(b * k).toFixed(1)
    return v > limit ? [`${key} ${v}, budget ${b}, limit ${limit} at load ${load.toFixed(2)}`] : []
  })
}

async function until(what, fn, ms = 30000) {
  const end = Date.now() + ms
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
    await sleep(40)
  }
}
const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

// in the page: each frame's work, from its rAF timestamp or the event that began it to a message posted after its rendering
export const PROBE = `(() => {
  if (window.__probe) return
  const after = fn => { const c = new MessageChannel(); c.port1.onmessage = () => fn(performance.now()); c.port2.postMessage(0) }
  const p = (window.__probe = { frames: [], on: false })
  const tick = ts => {
    requestAnimationFrame(tick)
    if (p.on) after(end => p.frames.push(end - ts))
  }
  requestAnimationFrame(tick)
  /** the work from an event to the end of the frame where check() holds, and the frames until then */
  p.event = (type, check) => new Promise(done => {
    const on = () => {
      const t0 = performance.now()
      window.removeEventListener(type, on, true)
      let n = 0
      const frame = () => after(end => {
        n++
        if (!check || check() || n > 30) done({ ms: end - t0, frames: n })
        else requestAnimationFrame(frame)
      })
      requestAnimationFrame(frame)
    }
    window.addEventListener(type, on, true)
  })
})()`
// before any script of the page: WebGL draws nothing, so a frame's work is the main thread's own, three.js's draw calls included, and
// never a software rasteriser's, which takes seconds a frame in a headless browser without a GPU
const NO_RASTER = `for (const C of [self.WebGLRenderingContext, self.WebGL2RenderingContext])
  for (const m of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'drawRangeElements', 'clear', 'blitFramebuffer'])
    if (C?.prototype[m]) C.prototype[m] = function () {}`

/** Frame work while nothing happens, ms: the median of `n` frames. */
const IDLE = n =>
  `new Promise(done => { const p = window.__probe; p.frames = []; p.on = true; const t = setInterval(() => { if (p.frames.length >= ${n}) { clearInterval(t); p.on = false; done(p.frames.slice()) } }, 20) })`

/** Every measurement on a scratch copy of usb3-hub; `dots` instead takes the screenshots of the 3D view with U1 moved onto its neighbours in
the source, rasterised for real: the findings as dots, one hovered with its tooltip, one clicked with its details in the chip. */
export async function viewBench({ shots, log = () => {}, devtools = 0, port = 0, dots = false } = {}) {
  const raster = dots
  const top = realpathSync(mkdtempSync(join(tmpdir(), 'pcbjs-view-')))
  const root = join(top, 'usb3-hub')
  cpSync(EXAMPLE, root, { recursive: true, filter: f => !/\/(node_modules|\.pcbjs\/(?!cache)[^/]*|\.pcbjs\/cache\/vite)(\/|$)/.test(f.slice(EXAMPLE.length)) })
  mkdirSync(join(root, 'node_modules'), { recursive: true })
  symlinkSync(join(REPO, 'node_modules', '@pcbjs'), join(root, 'node_modules', '@pcbjs'), 'dir')
  rmSync(join(root, '.pcbjs', 'dev.json'), { force: true })
  const entry = join(root, 'pcb.tsx')
  if (dots) writeFileSync(entry, readFileSync(entry, 'utf8').replace('<U1 at={`${HX} ${HY} -90deg`} />', '<U1 at={`${HX + 5} ${HY} -90deg`} />'))
  const run = join(top, 'run')
  mkdirSync(run)
  const children = []
  let text = ''
  try {
    const child = spawn(process.execPath, [BIN, 'session', 'serve', '--port', String(port), '--host', '127.0.0.1'], {
      cwd: root,
      env: { ...process.env, XDG_RUNTIME_DIR: run, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    children.push(child)
    child.stdout.on('data', d => (text += d))
    child.stderr.on('data', d => (text += d))
    await until('the session', () => /\[pcbjs\] session \w+, pid/.test(text), 60000)
    const dev = JSON.parse(readFileSync(join(root, '.pcbjs', 'dev.json'), 'utf8'))
    const chrome = await launchAny(chromes(), top, devtools)
    children.push(chrome.proc)
    const page = await cdp(chrome.socket)
    await page.send('Runtime.enable')
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false })
    await page.send('Page.enable')
    if (!raster) await page.send('Page.addScriptToEvaluateOnNewDocument', { source: NO_RASTER })
    const ev = expr => evaluate(page, expr)
    const shot = async name => {
      if (!shots) return
      mkdirSync(shots, { recursive: true })
      const { data } = await page.send('Page.captureScreenshot', { format: 'png' })
      writeFileSync(join(shots, `${name}.png`), Buffer.from(data, 'base64'))
    }
    const open = async (view, query = '') => {
      await page.send('Page.navigate', { url: new URL(`board/usb3-hub?view=${view}${query}`, dev.url).href })
      await until(
        `the ${view} view`,
        () => ev(`document.documentElement.dataset.ready === '${view}' || !!document.querySelector('[data-ready="${view}"]')`).catch(() => false),
        120000,
      )
      await ev(PROBE)
      await sleep(800)
    }
    // the load per core the run saw at its highest, sampled at its start, at each wheel step and at its end
    const out = { load: loadPerCore() }
    const mouse = (type, [x, y], o = {}) =>
      page.send('Input.dispatchMouseEvent', {
        type,
        x,
        y,
        button: type === 'mouseMoved' && !o.held ? 'none' : 'left',
        buttons: o.held || type === 'mousePressed' ? 1 : 0,
        clickCount: type === 'mouseMoved' ? 0 : 1,
      })
    /** One input event timed: the work from its dispatch in the page to the end of the frame where `check` holds, and that frame's number. */
    const timed = async (type, send, check) => {
      await ev(`window.__pending = window.__probe.event('${type}', ${check ? `() => (${check})` : 'null'}); 0`)
      await send()
      return ev('window.__pending')
    }
    const settle = () => ev('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 100))))')
    // board mm to screen px: the 2D layer's matrix, the 3D camera's projection of the top copper
    const at2d = ([x, y]) =>
      ev(`(() => { const m = document.querySelector('svg.board-svg g.layer').getScreenCTM(); return [m.a * ${x} + m.c * ${y} + m.e, m.b * ${x} + m.d * ${y} + m.f] })()`)
    const at3d = ([x, y]) =>
      ev(`(() => {
        const { camera: c } = window.__pcbjs3d, r = document.querySelector('canvas.view3d-canvas').getBoundingClientRect()
        c.updateMatrixWorld()
        const mul = (m, v) => [0, 1, 2, 3].map(i => m[i] * v[0] + m[4 + i] * v[1] + m[8 + i] * v[2] + m[12 + i] * v[3])
        const p = mul(c.projectionMatrix.elements, mul(c.matrixWorldInverse.elements, [${x}, ${-y}, 1.6, 1]))
        return [r.left + ((p[0] / p[3] + 1) / 2) * r.width, r.top + ((1 - p[1] / p[3]) / 2) * r.height]
      })()`)
    const pane = view =>
      ev(
        `(() => { const e = document.querySelector('${view === '2d' ? 'svg.board-svg' : 'canvas.view3d-canvas'}').getBoundingClientRect(); return [e.left + e.width / 2, e.top + e.height / 2] })()`,
      )
    const hovered = view => (view === '2d' ? `document.querySelector('g.hl.hv')?.childElementCount > 0` : `!!document.querySelector('.view3d')?.getAttribute('data-hover')`)
    const moved = view =>
      view === '2d'
        ? `!!document.querySelector('svg.board-svg g.layer [data-ref="U1"]')?.style.transform`
        : `(() => { let on = false; window.__pcbjs3d.scene.traverse(o => { if (o.userData.ref === 'U1' && o.parent?.name === 'bodies:F' && o.position.x) on = true }); return on })()`

    const chip = () => ev(`document.querySelector('.chips-bar')?.innerText ?? ''`)
    const findings = () =>
      ev(`(() => { const t = document.querySelector('.tabs, [role=tablist]')?.innerText ?? document.body.innerText; const m = /DRC\\s+(\\d+)/.exec(t); return m ? +m[1] : 0 })()`)

    /** Idle frames, pointer moves over empty board and parts, a hover onto U1 and wheel steps. */
    const still = async (view, out, tag = '') => {
      const to = view === '2d' ? at2d : at3d
      out[`idle${tag}${view}`] = median(await ev(IDLE(60)))
      if (tag) return
      if (view === '3d') out.calls3d = await ev('window.__pcbjs3d.calls')
      // a sweep in 3 px steps across parts and copper, as a hand moves, each move timed to the end of its frame
      const [a0, a1] = [await to([30, 36]), await to([62, 30])]
      const moves = []
      const steps = Math.max(8, Math.round(Math.hypot(a1[0] - a0[0], a1[1] - a0[1]) / 3))
      for (let i = 0; i <= steps; i++)
        moves.push((await timed('pointermove', () => mouse('mouseMoved', [a0[0] + ((a1[0] - a0[0]) * i) / steps, a0[1] + ((a1[1] - a0[1]) * i) / steps]))).ms)
      out[`move${view}`] = median(moves)
      out[`moveP90${view}`] = [...moves].sort((x, y) => x - y)[Math.floor(moves.length * 0.9)]
      const hov = []
      for (let i = 0; i < 5; i++) {
        await mouse('mouseMoved', await to([30, -6]))
        await settle()
        hov.push((await timed('pointermove', async () => mouse('mouseMoved', await to([46 + (i % 2) * 0.5, 34.5])), hovered(view))).frames)
      }
      out[`hover${view}`] = median(hov)
      const c = await pane(view)
      // two steps to warm up, then nine timed, in and out in turn
      const wheel = []
      for (let i = 0; i < 11; i++) {
        const step = (await timed('wheel', () => page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: c[0], y: c[1], deltaX: 0, deltaY: i % 2 ? 120 : -120 }))).ms
        if (i >= 2) wheel.push(step)
        out.load = Math.max(out.load ?? 0, loadPerCore())
        await sleep(150)
      }
      out[`wheel${view}`] = median(wheel)
      await settle()
    }
    /** Select the part at `from`, drag it 5 mm right in steps a frame apart: the first response in frames and the median frame; released or cancelled. */
    const dragU1 = async (view, out, from, release) => {
      const to = view === '2d' ? at2d : at3d
      await open(view, '&select=U1')
      const a = await to(from)
      await until('U1 selected', async () => /^U1/.test(await chip()), 10000).catch(async e => {
        await shot('failed')
        throw new Error(`${e.message}; chip: ${await chip()}`)
      })
      await until('its tools', async () => /Move/.test(await ev(`document.querySelector('.bv-edit')?.innerText ?? ''`)))
      await settle()
      if (view === '3d') out.callsFade3d ??= await ev('window.__pcbjs3d.calls')
      const b = await to([from[0] + 5, from[1]])
      await mouse('mousePressed', a)
      const first = await timed('pointermove', () => mouse('mouseMoved', [a[0] + 8, a[1]], { held: true }), moved(view))
      out[`dragFirst${view}`] = Math.max(out[`dragFirst${view}`] ?? 0, first.frames)
      await ev('window.__probe.frames = []; window.__probe.on = true')
      for (let i = 1; i <= 24; i++) {
        await mouse('mouseMoved', [a[0] + 8 + ((b[0] - a[0] - 8) * i) / 24, a[1]], { held: true })
        await sleep(16)
      }
      const frames = await ev('(window.__probe.on = false, window.__probe.frames.slice())')
      if (release) await mouse('mouseReleased', b)
      else {
        await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
        await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
        await mouse('mouseReleased', b)
      }
      return frames
    }

    if (dots) {
      // the dots of the DRC findings not drawn as lines, on the top copper, until one shows its tooltip
      const board = await (await fetch(new URL('__pcbjs/usb3-hub/board.json', dev.url))).json()
      const spots = board.drc.filter(d => !['unconnected', 'route-failed'].includes(d.rule) && !d.layer?.startsWith('B.')).map(d => d.at)
      await open('3d')
      await shot('usb3-hub-3d-dots')
      for (const at of spots.slice(0, 40)) {
        await mouse('mouseMoved', await at3d(at))
        await settle()
        await settle()
        const tip = await ev(`document.querySelector('.view3d-dot-tip')?.innerText ?? ''`)
        if (!tip) continue
        await shot('usb3-hub-3d-dot-hover')
        const p = await at3d(at)
        await mouse('mousePressed', p)
        await mouse('mouseReleased', p)
        await until('the finding in the chip', () => ev(`!!document.querySelector('.chips-bar .chip.finding')`), 60000)
        await sleep(3000)
        await settle()
        await shot('usb3-hub-3d-dot-focus')
        return { out: { tip }, text }
      }
      throw new Error('no dot showed its tooltip')
    }
    await open('2d')
    await still('2d', out)
    await open('3d')
    await still('3d', out)
    out.dragPlain3d = median(await dragU1('3d', out, [46, 34.5], false))
    log(out)
    // the drop that makes the findings: U1 5 mm right onto its neighbours, written to disk and compiled
    const before = await findings()
    const plain = await dragU1('2d', out, [46, 34.5], true)
    out.dragPlain2d = median(plain)
    await ev('window.__probe.frames = []; window.__probe.on = true')
    await until('the findings', async () => (await findings()) >= before + 50, 180000)
    await sleep(1500)
    const landing = await ev('(window.__probe.on = false, window.__probe.frames.slice())')
    out.findingCount = await findings()
    out.landingMax = Math.max(...landing)
    await open('2d')
    await shot('2d-findings')
    await still('2d', out, 'F')
    log(out)
    out.drag2d = median(await dragU1('2d', out, [51, 34.5], false))
    await open('3d')
    await shot('3d-findings')
    await still('3d', out, 'F')
    log(out)
    out.drag3d = median(await dragU1('3d', out, [51, 34.5], false))
    log(out)
    out.load = Math.max(out.load, loadPerCore())
    return { out, text }
  } finally {
    for (const c of children) c.kill('SIGKILL')
    rmSync(top, { recursive: true, force: true })
  }
}
