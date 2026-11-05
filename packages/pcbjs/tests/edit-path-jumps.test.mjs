// The edit path's editor jumps, the writes with no editor and the keys a pane passes to VS Code; the harness is edit-path-harness.mjs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  harness,
  REPO,
  S,
  TEXT0,
  VSC,
  chip,
  click,
  compiles,
  confirmations,
  dirs,
  drag,
  ed,
  editor,
  ev,
  instanceJump,
  key,
  page,
  quad,
  screenOf,
  serve,
  settled,
  show,
  skip,
  sleep,
  sockets,
  until,
} from './edit-path-harness.mjs'

harness()

test('the page speaks to the session on one socket, and Vite carries nothing of pcbjs', { skip }, async () => {
  const all = [...sockets.values()]
  assert.deepEqual(all.filter(w => new URL(w.url).pathname === '/__pcbjs/session').length, 1, all.map(w => w.url).join(' '))
  assert.deepEqual(
    all.filter(w => new URL(w.url).pathname !== '/__pcbjs/session' && w.pcbjs).map(w => w.url),
    [],
  )
})

test('with an editor the chip has no jump buttons; an alt-click jumps the editor to the definition of what a click selects, the selection kept', { skip }, async () => {
  await show('Blinky', 'R1')
  await settled('Blinky')
  await click(await screenOf(11.175, 5))
  await until('CH1 selected', async () => (await chip()).startsWith('CH1'))
  assert.equal(
    await ev(`[...document.querySelectorAll('.chips-bar button')].filter(b => /Open (placement|definition)/.test(b.textContent)).length`),
    0,
    'no Open placement or Open definition',
  )
  assert.match(await ev(`document.querySelector('.chips-bar .chip.path').title`), /click: placement, (alt|option)-click: definition/)
  const jump = async (at, file) => {
    const n = ed.selects.length
    await click(at, { modifiers: 1 })
    await until(`the editor at ${file}`, () => ed.selects.length > n)
    const s = ed.selects.at(-1)
    assert.ok(s.primary.uri.endsWith(file), `${s.primary.uri} is ${file}`)
    await sleep(300)
    assert.match(await chip(), /^CH1/, 'the selection stays')
  }
  // with CH1 selected a click on R1 selects CH1/R: its declaration in the circuit; J1's declaration, `const J1 = ...`
  await jump(await screenOf(11.175, 5), 'lib/led-channel.tsx')
  await jump(await screenOf(3, 7.46), 'blinky.sch.tsx')
  await show('Quad', 'J1')
})

test('an instance selected in a project session jumps the editor to its layout expression', { skip }, async () => {
  await instanceJump(ed, dirname(quad))
})

test('with no editor holding the file a drag writes to disk, once', { skip }, async () => {
  ed.type(TEXT0)
  await ed.doc.save()
  await ed.close()
  await settled()
  await key('Escape', 'Escape')
  await click(await screenOf(3, 8.77))
  await until('J1 selected', async () => (await chip()).startsWith('J1'))
  await until('the toolbar says it writes to disk', async () => /write to disk/.test(await ev(`document.querySelector('.bv-edit')?.title ?? ''`)))
  const n = compiles()
  const logged = S.log.text.length
  await drag(await screenOf(3, 8.77), await screenOf(5, 8.77))
  await until('the file on disk', () => !readFileSync(quad, 'utf8').includes('<J1 at="3 6.23" />'))
  assert.match(readFileSync(quad, 'utf8'), /<J1 at="5 6\.23" \/>/)
  await until('a compile', () => compiles() > n, 20000)
  await until('the confirmation', async () => (await confirmations()).includes('Updated'))
  await sleep(600)
  assert.equal(compiles() - n, 1, `one compile\n${S.log.text.slice(logged)}`)
  assert.equal(readFileSync(quad, 'utf8'), TEXT0.replace('<J1 at="3 6.23" />', '<J1 at="5 6.23" />'))
})

test('after a change on disk the session compiles for the views shown, and a drag still moves from where the view shows the part', { skip }, async () => {
  writeFileSync(quad, readFileSync(quad, 'utf8').replace('<J1 at="5 6.23" />', '<J1 at="4 6.23" />'))
  await until('the view redrawn', async () => {
    const r = await ev(`(() => { const e = document.querySelector('svg.board-svg g.layer [data-ref="J1"][data-kind="pad"]'); return e && e.getBBox().x })()`)
    return r !== null && r > 3
  })
  await settled()
  await drag(await screenOf(4, 8.77), await screenOf(6, 8.77))
  await until('the file on disk', () => !readFileSync(quad, 'utf8').includes('<J1 at="4 6.23" />'))
  assert.match(readFileSync(quad, 'utf8'), /<J1 at="6 6\.23" \/>/, 'the edit read the board the view shows, not an older one')
})

test('an instance selected in a workspace session jumps the editor to its layout expression', { skip }, async () => {
  const top = realpathSync(mkdtempSync(join(tmpdir(), 'pcbjs-edit-ws-')))
  dirs.push(top)
  mkdirSync(join(top, 'node_modules'))
  symlinkSync(join(REPO, 'node_modules', '@pcbjs'), join(top, 'node_modules', '@pcbjs'), 'dir')
  // demo after another project, so the first scope is not the one on display
  for (const name of ['badge', 'demo']) {
    const from = join(REPO, 'examples', name)
    cpSync(from, join(top, name), { recursive: true, filter: f => !/\/(node_modules|\.pcbjs)(\/|$)/.test(f.slice(from.length)) })
  }
  const root = join(top, 'demo')
  const cfg = join(root, 'pcb.config.ts')
  writeFileSync(cfg, readFileSync(cfg, 'utf8').replace(/entries: \[[^\]]*\]/, "entries: ['blinky.pcb.tsx']"))
  const run = join(top, 'run')
  mkdirSync(run)
  const ws = await serve(top, run, ['--workspace', top])
  await until('the demo project', () => existsSync(join(root, '.pcbjs', 'dev.json')), 30000)
  const info = JSON.parse(readFileSync(join(root, '.pcbjs', 'dev.json'), 'utf8'))
  assert.equal((await fetch(new URL('/__pcbjs/scope/demo', info.url))).status, 200)
  const e = await editor(top, join(root, 'blinky.pcb.tsx'))
  try {
    await e.link.request('session/check', { project: root }, 120000)
    await instanceJump(e, root)
  } finally {
    await e.close()
    ws.child.kill('SIGKILL')
  }
})

test('cmd or ctrl P in the viewer of a pane passes untouched to the pane page, where VS Code takes it', { skip }, async () => {
  const fake = await import(pathToFileURL(join(VSC, 'tests', 'vscode.mjs')).href)
  const { Preview } = createRequire(join(VSC, 'package.json'))('./dist/preview.cjs')
  const p = new Preview({ ensureStarted: async () => {}, board: () => undefined, onChange: () => {}, icon: { light: 'l.svg', dark: 'd.svg' } })
  const url = S.dev.url
  await p.open(
    {
      root: dirname(quad),
      name: 'demo',
      active: true,
      state: { kind: 'running', url },
      boards: null,
      scope: undefined,
      page: '/board/Quad',
      recent: () => [],
    },
    '2d',
  )
  // the extension's own pane page, VS Code's API stubbed: its webview host listens for keydown on this document
  const html = fake.panels.at(-1).webview.html.replace('const vscode = acquireVsCodeApi();', 'const vscode = { postMessage() {}, setState() {} };')
  // served from another origin, as VS Code serves its webviews
  const host = createServer((_, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(html))
  await new Promise(r => host.listen(0, '127.0.0.1', r))
  await page.send('Page.navigate', { url: `http://127.0.0.1:${host.address().port}/` })
  await until('the pane page', () => ev(`!!document.getElementById('viewer')`).catch(() => false))
  await ev(
    `window.__keys = []; document.addEventListener('keydown', e => window.__keys.push({ key: e.key, meta: e.metaKey, ctrl: e.ctrlKey, shift: e.shiftKey, prevented: e.defaultPrevented }))`,
  )
  const frameReady = async () => {
    const { frameTree } = await page.send('Page.getFrameTree')
    return frameTree.childFrames?.some(f => f.frame.url.startsWith(url))
  }
  await until('the viewer in the pane', frameReady, 30000)
  await sleep(2500)
  // focus inside the viewer's frame, on empty canvas
  await click([700, 860])
  const mac = (await ev('navigator.platform')).startsWith('Mac')
  const mod = mac ? 4 : 2
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'p', code: 'KeyP', modifiers: mod, windowsVirtualKeyCode: 80 })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'p', code: 'KeyP', modifiers: mod, windowsVirtualKeyCode: 80 })
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'P', code: 'KeyP', modifiers: mod | 8, windowsVirtualKeyCode: 80 })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'P', code: 'KeyP', modifiers: mod | 8, windowsVirtualKeyCode: 80 })
  await until('the chords on the pane page', async () => (await ev('window.__keys')).length >= 2)
  const keys = await ev('window.__keys')
  assert.deepEqual(
    keys.map(k => [k.key.toLowerCase(), mac ? k.meta : k.ctrl, k.shift, k.prevented]),
    [
      ['p', true, false, false],
      ['p', true, true, false],
    ],
  )
  p.dispose()
  host.close()
})
