import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { panels, tabGroups } from './vscode.mjs'

const require = createRequire(import.meta.url)
const { Preview, savedView } = require('../dist/preview.cjs')
const { shownBoard, boardUrl, panelTitle } = require('../dist/views.cjs')

function fakeServer() {
  return {
    root: '/work/demo',
    name: 'demo',
    active: true,
    state: { kind: 'running', url: 'http://127.0.0.1:5301/' },
    boards: {
      boards: [
        { name: 'Blinky', title: 'Blinky', entry: 'blinky.pcb.tsx' },
        { name: 'Coin', title: 'Coin', entry: 'coin.tsx' },
      ],
      root: '/work/demo',
    },
    scope: undefined,
    previewUrl: undefined,
    recent: () => [],
  }
}

function makePreview(more = {}) {
  let last
  const editor = { file: undefined, shown: undefined }
  const preview = new Preview({
    ensureStarted: async () => {},
    externalUrl: () => undefined,
    board: s => {
      const b = shownBoard(s.boards, editor.shown, editor.file, s.root)
      editor.shown = b?.name
      return b
    },
    onChange: () => {},
    lastView: { get: () => last, set: v => (last = v) },
    icon: { light: 'light.svg', dark: 'dark.svg' },
    ...more,
  })
  return { preview, editor, last: () => last }
}

const titles = p => p.tabs.map(t => t.title)
const iframe = panel => /<iframe id="viewer" src="([^"]+)"/.exec(panel.webview.html)?.[1].replace(/&amp;/g, '&')

test('one tab per view, titled board | view, each loading its own view without the side panel', async () => {
  panels.length = 0
  const { preview, last } = makePreview()
  const server = fakeServer()
  await preview.open(server, '2d')
  await preview.open(server, '3d')
  await preview.open(server, 'sch')
  assert.equal(panels.length, 3)
  assert.deepEqual(titles(preview), ['Blinky | 2D', 'Blinky | 3D', 'Blinky | Schematic'])
  assert.ok(panels.every(p => p.viewType === 'pcbjs.preview' && p.iconPath.light === 'light.svg' && p.options.retainContextWhenHidden))
  assert.deepEqual(
    panels.map(iframe),
    ['2d', '3d', 'sch'].map(v => `http://127.0.0.1:5301/?ide=1&theme=dark&view=${v}&panel=0`),
  )
  assert.ok(panels[1].webview.html.includes('setState({ view: "3d" })'))
  assert.equal(last(), 'sch')
  // the open command with no view opens the last used one: it is open, so the toggle closes it
  panels[0].focus()
  assert.equal(last(), '2d')
  await preview.toggle(server)
  assert.deepEqual(titles(preview), ['Blinky | 3D', 'Blinky | Schematic'])
  assert.equal(savedView({ view: 'sch' }), 'sch')
  assert.equal(savedView(undefined), '2d')
  preview.dispose()
})

test('the titles follow the board shown: an entry in focus, then a scope switch of a workspace server', async () => {
  panels.length = 0
  const { preview, editor } = makePreview()
  const server = fakeServer()
  await preview.open(server, '2d')
  await preview.open(server, '3d')
  editor.file = '/work/demo/coin.tsx'
  await preview.update()
  assert.deepEqual(titles(preview), ['Coin | 2D', 'Coin | 3D'])
  // a file that is no entry keeps the board
  editor.file = '/work/demo/lib/part.tsx'
  await preview.update()
  assert.deepEqual(titles(preview), ['Coin | 2D', 'Coin | 3D'])
  server.scope = { scope: 'usb', root: '/work/usb-hub', route: '/usb-hub/', url: 'http://127.0.0.1:5301/usb-hub/' }
  server.boards = { boards: [{ name: 'Hub', title: 'USB hub', entry: 'pcb.tsx' }], root: '/work/usb-hub' }
  await preview.update()
  assert.deepEqual(titles(preview), ['USB hub | 2D', 'USB hub | 3D'])
  preview.dispose()
})

test('a board, a scope or a request from the sidebar reaches every panel', async () => {
  panels.length = 0
  const { preview } = makePreview()
  const server = fakeServer()
  server.scope = { scope: 'demo', root: '/work/demo', route: '/demo/', url: 'http://127.0.0.1:5301/demo/' }
  await preview.open(server, '2d')
  await preview.open(server, 'sch')
  await preview.showBoard(server, 'Coin')
  assert.deepEqual(
    panels.map(p => p.posted.at(-1)),
    ['2d', 'sch'].map(v => ({ type: 'src', src: `http://127.0.0.1:5301/demo/board/Coin?ide=1&theme=dark&view=${v}&panel=0` })),
  )
  await preview.showScope(server, '/usb-hub/')
  assert.equal(panels[0].posted.at(-1).src, 'http://127.0.0.1:5301/usb-hub/?ide=1&theme=dark&view=2d&panel=0')
  preview.post({ type: 'pcbjs:net', board: 'Coin', net: 'GND' })
  assert.ok(panels.every(p => p.posted.at(-1).type === 'post' && p.posted.at(-1).data.net === 'GND'))
  // the reload of one view leaves the other frame alone
  const html = panels[1].webview.html
  panels[0].webview.html = ''
  await preview.reload(server, '2d')
  assert.ok(panels[0].webview.html.includes('view=2d'))
  assert.equal(panels[1].webview.html, html)
  preview.dispose()
})

const reset = () => {
  panels.length = 0
  tabGroups.activeTabGroup.viewColumn = 1
}

test('each beside action opens its view in the next column, from the code and from a pane', async () => {
  reset()
  const { preview } = makePreview()
  const server = fakeServer()
  await preview.open(server, '2d', 'beside')
  assert.equal(panels[0].viewColumn, 2)
  panels[0].focus()
  await preview.open(server, '3d', 'beside')
  assert.equal(panels[1].viewColumn, 3)
  panels[1].focus()
  await preview.open(server, 'sch', 'beside')
  assert.equal(panels[2].viewColumn, 4)
  assert.deepEqual(titles(preview), ['Blinky | 2D', 'Blinky | 3D', 'Blinky | Schematic'])
  preview.dispose()
})

test('all views: three panes side by side from the code, the two others from a pane', async () => {
  reset()
  const { preview } = makePreview()
  const server = fakeServer()
  await preview.openAll(server)
  assert.deepEqual(
    panels.map(p => p.viewColumn),
    [2, 3, 4],
  )
  assert.deepEqual(titles(preview), ['Blinky | 2D', 'Blinky | 3D', 'Blinky | Schematic'])
  await preview.openAll(server)
  assert.equal(panels.length, 3)
  preview.dispose()
  reset()
  const second = makePreview().preview
  await second.open(server, '3d', 'beside')
  panels[0].focus()
  await second.openAll(server)
  assert.deepEqual(
    second.tabs.map(t => t.view),
    ['2d', '3d', 'sch'],
  )
  assert.deepEqual(
    panels.map(p => p.viewColumn),
    [2, 3, 4],
  )
  second.dispose()
})

test('a view opened again reveals and focuses its pane, from the code or from that pane; only the modifier opens another, numbered', async () => {
  reset()
  const { preview } = makePreview()
  const server = fakeServer()
  await preview.open(server, '3d', 'beside')
  await preview.open(server, '3d', 'beside')
  await preview.open(server, '3d')
  assert.equal(panels.length, 1)
  assert.equal(panels[0].revealed, 2)
  assert.equal(preview.active, '3d')
  await preview.open(server, '3d', 'beside')
  assert.equal(panels.length, 1)
  assert.equal(panels[0].revealed, 3)
  await preview.open(server, '3d', 'new')
  assert.equal(panels.length, 2)
  assert.equal(panels[1].viewColumn, 3)
  assert.deepEqual(titles(preview), ['Blinky | 3D', 'Blinky | 3D (2)'])
  tabGroups.activeTabGroup.viewColumn = 1
  panels[0].active = false
  await preview.open(server, '3d', 'new')
  assert.deepEqual(titles(preview), ['Blinky | 3D', 'Blinky | 3D (2)', 'Blinky | 3D (3)'])
  // a closed number is the next one handed out
  panels[1].dispose()
  await preview.open(server, '3d', 'new')
  assert.deepEqual(titles(preview), ['Blinky | 3D', 'Blinky | 3D (2)', 'Blinky | 3D (3)'])
  assert.equal(panelTitle('Blinky', '3d', 2), 'Blinky | 3D (2)')
  preview.dispose()
})

test('a new pane of a running server shows the viewer from its first frame, with no status page between', async () => {
  reset()
  const { preview } = makePreview()
  const server = fakeServer()
  await preview.open(server, '2d')
  const pending = preview.open(server, 'sch', 'new')
  assert.equal(iframe(panels[1]), 'http://127.0.0.1:5301/?ide=1&theme=dark&view=sch&panel=0')
  await pending
  preview.dispose()
})

const sleep = ms => new Promise(r => setTimeout(r, ms))
const screens = panel => panel.posted.filter(m => m.type === 'screen')

test('a pane paints the shared loading screen first, and a server still stopped after the grace says so in place', async () => {
  reset()
  const { preview } = makePreview({ graceMs: 40 })
  const server = { ...fakeServer(), active: false, state: { kind: 'stopped' }, boards: undefined }
  await preview.open(server, '2d', 'reuse', false)
  const html = panels[0].webview.html
  for (const part of ['class="load-screen"', 'class="waves"', 'class="mark"', 'class="spin"', 'data-busy', '.load-screen {', 'waiting for the dev server'])
    assert.ok(html.includes(part), part)
  assert.ok(!html.includes('is stopped') && !html.includes('data-cmd="start"'), 'nothing says stopped before the grace')
  assert.equal(screens(panels[0]).length, 0)
  await sleep(80)
  const [m] = screens(panels[0])
  assert.equal(m.text, 'the dev server is stopped')
  assert.equal(m.busy, false)
  assert.ok(m.actions.includes('data-cmd="start"') && m.actions.includes('data-cmd="output"'))
  assert.ok(!panels[0].webview.html.includes('is stopped'), 'the page changes in place, it is not loaded again')
  preview.dispose()
})

test('a pane that starts its server never shows it stopped, and the viewer page lies over the same screen', async () => {
  reset()
  const server = { ...fakeServer(), active: false, state: { kind: 'stopped' } }
  const { preview } = makePreview({
    graceMs: 40,
    ensureStarted: async s => {
      s.state = { kind: 'starting' }
      await preview.update()
      s.state = { kind: 'running', url: 'http://127.0.0.1:5301/' }
      s.active = true
      await preview.update()
    },
  })
  await preview.open(server, '2d')
  await sleep(80)
  assert.ok(screens(panels[0]).every(m => m.state === 'loading' && !m.actions))
  assert.deepEqual(
    screens(panels[0]).map(m => m.text),
    ['starting the dev server'],
  )
  const html = panels[0].webview.html
  assert.ok(iframe(panels[0]))
  assert.ok(html.includes('class="load-screen"') && html.includes('loading the viewer') && !html.includes('is stopped'))
  preview.dispose()
})

test('a running server with no board to show: the idle screen under the viewer, no spinner, and the Boards view named', async () => {
  reset()
  const { preview } = makePreview()
  const server = { ...fakeServer(), boards: { boards: [], root: '/work/demo' } }
  await preview.open(server, '2d')
  const html = panels[0].webview.html
  assert.ok(iframe(panels[0]))
  assert.ok(html.includes('data-state="idle"') && html.includes('Select a board file to get started') && html.includes('Boards view'))
  assert.ok(!/class="load-screen"[^>]*data-busy/.test(html))
  preview.dispose()
})

test('board URLs under a scope page or a board page, and the title format', () => {
  assert.equal(boardUrl('http://127.0.0.1:5301/demo/', 'Blinky'), 'http://127.0.0.1:5301/demo/board/Blinky')
  assert.equal(boardUrl('http://127.0.0.1:5301/demo/board/Coin/jlc?ide=1', 'A B'), 'http://127.0.0.1:5301/demo/board/A%20B')
  assert.equal(panelTitle('Blinky', 'sch'), 'Blinky | Schematic')
})

test('the manifest: beside actions on a pane, an entry and a board row, Alt and Shift open another, keys only in a pcbjs project', () => {
  const { contributes: c } = require('../package.json')
  const ids = new Set(c.commands.map(x => x.command))
  const title = c.menus['editor/title']
  for (const m of [...title, ...c.menus['view/item/context'], ...c.keybindings]) assert.ok(ids.has(m.command) && (!m.alt || ids.has(m.alt)), m.command)
  for (const v of ['2D', '3D', 'Schematic']) {
    const on = title.filter(m => m.command === `pcbjs.open${v}Beside`)
    assert.equal(on.length, 2)
    assert.ok(on.every(m => m.alt === `pcbjs.open${v}New`))
    assert.equal(c.menus['view/item/context'].find(m => m.command === `pcbjs.board.open${v}`).alt, `pcbjs.board.open${v}New`)
  }
  assert.ok(title.some(m => m.command === 'pcbjs.openAllViews' && m.when.includes('pcbjs.entries')))
  assert.deepEqual(
    c.keybindings.map(k => [k.command, k.key, k.mac, k.when]),
    [
      ['pcbjs.open2DBeside', 'ctrl+alt+2', 'cmd+alt+2', 'pcbjs.active'],
      ['pcbjs.open3DBeside', 'ctrl+alt+3', 'cmd+alt+3', 'pcbjs.active'],
      ['pcbjs.openSchematicBeside', 'ctrl+alt+s', 'cmd+alt+s', 'pcbjs.active'],
      ['pcbjs.open2DNew', 'ctrl+alt+shift+2', 'cmd+alt+shift+2', 'pcbjs.active'],
      ['pcbjs.open3DNew', 'ctrl+alt+shift+3', 'cmd+alt+shift+3', 'pcbjs.active'],
      ['pcbjs.openSchematicNew', 'ctrl+alt+shift+s', 'cmd+alt+shift+s', 'pcbjs.active'],
    ],
  )
})
