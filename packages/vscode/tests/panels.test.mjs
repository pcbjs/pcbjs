import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { vscode, panels, tabGroups, group, setGroups, ui } from './vscode.mjs'

const require = createRequire(import.meta.url)
const { Preview, savedView } = require('../dist/preview.cjs')
const { shownBoard, boardPath, panelTitle } = require('../dist/views.cjs')

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
    page: undefined,
    recent: () => [],
  }
}

function makePreview(more = {}) {
  let last
  const editor = { file: undefined, shown: undefined }
  const preview = new Preview({
    ensureStarted: async () => {},
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
  server.page = '/demo/'
  await preview.open(server, '2d')
  await preview.open(server, 'sch')
  await preview.showBoard(server, 'Coin')
  assert.deepEqual(
    panels.map(p => p.posted.at(-1)),
    ['2d', 'sch'].map(() => ({ type: 'post', data: { type: 'pcbjs:view', board: 'Coin' } })),
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

test('all views: four panes with checks using its editor-group policy', async () => {
  reset()
  const { preview } = makePreview()
  const server = fakeServer()
  await preview.openAll(server)
  assert.deepEqual(
    panels.map(p => p.viewColumn),
    [2, 3, 4, 2],
  )
  assert.deepEqual(titles(preview), ['Blinky | 2D', 'Blinky | 3D', 'Blinky | Schematic', 'Blinky | DRC/ERC'])
  await preview.openAll(server)
  assert.equal(panels.length, 4)
  preview.dispose()
  reset()
  const second = makePreview().preview
  await second.open(server, '3d', 'beside')
  panels[0].focus()
  await second.openAll(server)
  assert.deepEqual(
    second.tabs.map(t => t.view),
    ['2d', '3d', 'sch', 'checks'],
  )
  assert.deepEqual(
    panels.map(p => p.viewColumn),
    [2, 3, 4, 3],
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

test('restored previews finish loading when scope changes while the external URL resolves', async () => {
  reset()
  const external = vscode.env.asExternalUri
  const pending = []
  vscode.env.asExternalUri = uri => new Promise(resolve => pending.push(() => resolve(uri)))
  const link = { open: true, root: '/work/demo', info: { urls: ['http://127.0.0.1:5301/'] }, boards: fakeServer().boards, scope: { root: '/work/demo', url: '/' } }
  const { preview } = makePreview({ link: () => link })
  const server = fakeServer()
  try {
    for (const view of ['2d', '3d', 'sch', 'checks']) {
      const panel = vscode.window.createWebviewPanel('pcbjs.preview', view, 1, {})
      preview.adopt(panel, view)
    }
    const loading = preview.resume(server)
    await sleep(0)
    assert.equal(pending.length, 4)
    link.scope.url = '/demo/'
    preview.follow(server, '/demo/', link)
    for (const done of pending.splice(0)) done()
    await loading
    for (const panel of panels) {
      assert.ok(iframe(panel), panel.title)
      assert.equal(new URL(iframe(panel)).pathname, '/demo/')
    }
    const html = panels.map(p => p.webview.html)
    await preview.update()
    assert.deepEqual(panels.map(p => p.webview.html), html, 'settled panels are not reloaded')
  } finally {
    vscode.env.asExternalUri = external
    preview.dispose()
  }
})

test('a panel restored after the first resume participates in the pending attachment', async () => {
  reset()
  const external = vscode.env.asExternalUri
  const pending = []
  vscode.env.asExternalUri = uri => new Promise(resolve => pending.push(() => resolve(uri)))
  const { preview } = makePreview()
  const server = fakeServer()
  try {
    preview.adopt(vscode.window.createWebviewPanel('pcbjs.preview', '2d', 1, {}), '2d')
    const first = preview.resume(server)
    await sleep(0)
    preview.adopt(vscode.window.createWebviewPanel('pcbjs.preview', '3d', 2, {}), '3d')
    const second = preview.resume(server)
    await sleep(0)
    for (const done of pending.splice(0)) done()
    await Promise.all([first, second])
    assert.ok(panels.every(p => iframe(p)), 'both restored views leave the status screen')
  } finally {
    vscode.env.asExternalUri = external
    preview.dispose()
  }
})

test('an obsolete pending viewer cannot replace a newer attachment failure screen', async () => {
  reset()
  const external = vscode.env.asExternalUri
  let finish
  vscode.env.asExternalUri = uri => new Promise(resolve => { finish = () => resolve(uri) })
  const { preview } = makePreview()
  const server = fakeServer()
  try {
    const loading = preview.open(server, '3d', 'reuse', false)
    await sleep(0)
    server.state = { kind: 'failed', reason: 'connection lost' }
    await preview.update()
    finish()
    await loading
    assert.equal(iframe(panels[0]), undefined)
    assert.ok(screens(panels[0]).some(m => m.state === 'failed' && m.text.includes('connection lost')))
  } finally {
    vscode.env.asExternalUri = external
    preview.dispose()
  }
})

test('a pane paints the shared loading screen first, and a server still stopped after the grace says so in place', async () => {
  reset()
  const { preview } = makePreview({ graceMs: 40 })
  const server = { ...fakeServer(), active: false, state: { kind: 'detached' }, boards: undefined }
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
  const server = { ...fakeServer(), active: false, state: { kind: 'detached' } }
  const { preview } = makePreview({
    graceMs: 40,
    ensureStarted: async s => {
      s.state = { kind: 'attaching' }
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
    ['attaching to the session'],
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

test('board paths under a scope page or a board page, and the title format', () => {
  assert.equal(boardPath('/demo/', 'Blinky'), '/demo/board/Blinky')
  assert.equal(boardPath('/demo/board/Coin/jlc?ide=1', 'A B'), '/demo/board/A%20B')
  assert.equal(boardPath('/', 'Quad'), '/board/Quad')
  assert.equal(panelTitle('Blinky', 'sch'), 'Blinky | Schematic')
})

test('the manifest: beside actions on a pane, an entry and a board row, Alt and Shift open another, keys only in a pcbjs project', () => {
  const { contributes: c } = require('../package.json')
  const ids = new Set(c.commands.map(x => x.command))
  const title = c.menus['editor/title']
  for (const m of [...title, ...c.menus['view/item/context'], ...c.keybindings]) assert.ok(ids.has(m.command) && (!m.alt || ids.has(m.alt)), m.command)
  assert.ok(![...ids].some(id => id.startsWith('pcbjs.board.')), 'a board row runs the view commands with the row as argument')
  for (const v of ['2D', '3D', 'Schematic', 'Checks']) {
    const on = title.filter(m => m.command === `pcbjs.open${v}Beside`)
    assert.equal(on.length, 2)
    assert.ok(on.every(m => m.alt === `pcbjs.open${v}New`))
    assert.equal(c.menus['view/item/context'].find(m => m.command === `pcbjs.open${v}`).alt, `pcbjs.open${v}New`)
  }
  assert.ok(title.some(m => m.command === 'pcbjs.openAllViews' && m.when.includes('pcbjs.entries')))
  assert.deepEqual(
    c.keybindings.map(k => [k.command, k.key, k.mac, k.when]),
    [
      ['pcbjs.open2DBeside', 'ctrl+alt+2', 'cmd+alt+2', 'pcbjs.active'],
      ['pcbjs.open2DNew', 'ctrl+alt+shift+2', 'cmd+alt+shift+2', 'pcbjs.active'],
      ['pcbjs.open3DBeside', 'ctrl+alt+3', 'cmd+alt+3', 'pcbjs.active'],
      ['pcbjs.open3DNew', 'ctrl+alt+shift+3', 'cmd+alt+shift+3', 'pcbjs.active'],
      ['pcbjs.openSchematicBeside', 'ctrl+alt+s', 'cmd+alt+s', 'pcbjs.active'],
      ['pcbjs.openSchematicNew', 'ctrl+alt+shift+s', 'cmd+alt+shift+s', 'pcbjs.active'],
      ['pcbjs.openChecksBeside', 'ctrl+alt+4', 'cmd+alt+4', 'pcbjs.active'],
      ['pcbjs.openChecksNew', 'ctrl+alt+shift+4', 'cmd+alt+shift+4', 'pcbjs.active'],
      ['pcbjs.restartClean', 'ctrl+shift+r', 'cmd+shift+r', "activeWebviewPanelId == 'pcbjs.preview'"],
    ],
  )
})

for (const duplicate of [false, true]) test(`pane URL and sidebar source share the owning session (${duplicate ? 'duplicate' : 'distinct'} board routes)`, async () => {
  const { Sidebar } = require('../dist/sidebar.cjs')
  panels.length = 0
  const links = ['alpha', 'beta'].map((session, i) => {
    const root = `/work/${session}`
    const name = duplicate ? 'Board' : session
    const route = duplicate ? '/project/' : `/${session}/`
    return {
      session, root, open: true,
      dev: { url: `http://127.0.0.1:${5301 + i}/` },
      info: { urls: [`http://127.0.0.1:${5301 + i}/`] },
      scope: { root, url: route },
      boards: { root, boards: [{ name, entry: 'pcb.tsx' }] },
    }
  })
  let owner = links[0]
  const server = fakeServer()
  const { preview } = makePreview({ link: () => owner, board: () => owner.boards.boards[0] })
  const sidebar = new Sidebar(async link => [{ board: link.boards.boards[0].name, facet: 'layers', hash: link.session, data: {
    name: link.boards.boards[0].name, nets: [], bom: [],
    footprints: [{ ref: 'R1', src: { file: 'pcb.tsx', line: 4, col: 1 } }],
  } }], false)
  try {
    await preview.open(server, '2d')
    for (const link of [links[0], links[1], links[0]]) {
      owner = link
      panels[0].posted.length = 0
      await preview.update()
      await sidebar.update(link, link.boards.boards[0])
      await preview.showBoard(server, link.boards.boards[0].name)
      const src = new URL(panels[0].posted.findLast(m => m.type === 'src')?.src ?? iframe(panels[0]))
      assert.equal(src.origin, new URL(link.dev.url).origin)
      assert.equal(panels[0].posted.at(-1).data.board, link.boards.boards[0].name)
      const row = sidebar.node('boards', `board:${link.root}:${link.boards.boards[0].name}`)
      assert.equal(row?.action.session, link.session)
      assert.equal(row.children[0].action.source.file, `${link.root}/pcb.tsx`)
      assert.equal(row.children[0].action.session, link.session)
      const stale = links.find(l => l !== link)
      preview.follow(server, '/wrong/', stale)
      await preview.reload(server)
      assert.equal(new URL(iframe(panels[0])).origin, new URL(link.dev.url).origin)
      assert.equal(new URL(iframe(panels[0])).pathname, `${link.scope.url}board/${link.boards.boards[0].name}`)
    }
  } finally {
    preview.dispose()
    sidebar.dispose()
  }
})

 test('same-board navigation keeps frames and repeated source focus retains the chosen board of a shared entry', async () => {
  panels.length = 0
  const { preview } = makePreview()
  const server = fakeServer()
  await preview.open(server, '2d')
  await preview.showBoard(server, 'Coin')
  panels[0].posted.length = 0
  const html = panels[0].webview.html
  await preview.showBoard(server, 'Coin')
  assert.equal(panels[0].webview.html, html)
  assert.equal(panels[0].posted.filter(p => p.type === 'src' || p.type === 'post').length, 0)
  const boards = { root: '/p', boards: [{ name: 'A', entry: 'both.tsx' }, { name: 'B', entry: 'both.tsx' }] }
  assert.equal(shownBoard(boards, 'B', '/p/both.tsx').name, 'B')
  preview.dispose()
})


test('checks reuse the live pane across findings, preserve preview focus and clear focus only when closed', async () => {
  panels.length = 0
  setGroups([group('/work/demo/custom.tsx'), group('pane')], 1)
  const active = tabGroups.activeTabGroup
  const calls = []
  const server = fakeServer()
  const link = {
    root: '/work/demo', open: true, info: { root: '/work/demo', port: 5301 },
    scopes: { scopes: [{ root: '/work/demo', route: '/demo/', boards: [{ name: 'Blinky', entry: 'custom.tsx' }] }] },
    request: async (...args) => { calls.push(args) },
  }
  const preview = makePreview({ link: () => link }).preview
  const event = { project: '/work/demo', board: 'Blinky', finding: { id: 'drc:a', rule: 'clearance', message: 'detail', refs: ['R1/1'] }, refs: ['drc:a'], anchor: 'drc:a' }
  await preview.open(server, '2d')
  await preview.finding(server, event, link)
  const checks = panels.at(-1)
  assert.equal(checks.viewColumn, 1)
  assert.equal(tabGroups.activeTabGroup, active)
  assert.ok(iframe(checks).includes('view=checks'))
  const html = checks.webview.html
  await preview.finding(server, { ...event, finding: { ...event.finding, id: 'drc:b' } }, link)
  await preview.finding(server, { ...event, finding: null }, link)
  assert.equal(panels.length, 2)
  assert.equal(checks.webview.html, html)
  assert.equal(checks.disposed, false)
  const before = ui.clipboard.length
  checks.webview.receive({ type: 'copy-markdown', id: 'copy-1', text: '# Clearance' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(ui.clipboard.length, before + 1)
  assert.equal(ui.clipboard.at(-1), '# Clearance')
  assert.deepEqual(checks.posted.at(-1), { type: 'post', data: { type: 'pcbjs:copied-markdown', id: 'copy-1', ok: true } })
  link.open = false
  const reconnected = { ...link, open: true, roots: ['/work/demo'], info: { root: '/work/demo', port: 5302 } }
  server.links = [reconnected]
  await preview.update()
  assert.equal(panels.length, 2)
  assert.ok(iframe(checks).includes('127.0.0.1:5302/demo/board/Blinky'))
  checks.dispose()
  assert.deepEqual(calls.at(-1), ['session/select', { project: '/work/demo', board: 'Blinky', refs: [], finding: null }])
  assert.equal(calls.length, 1)
  preview.dispose()
})

const ownedLink = (root, port, calls) => ({
  root, roots: [root], open: true, info: { root, port },
  scope: { root, url: '/project/' },
  boards: { root, boards: [{ name: 'Board', entry: 'pcb.tsx' }, { name: 'Other', entry: 'other.tsx' }] },
  request: async (...args) => calls.push(args),
})
const findingEvent = (link, target) => ({ project: link.root, board: 'Board', target, finding: { id: 'drc:a', refs: ['R1'] }, refs: ['drc:a'], anchor: 'drc:a' })

test('retarget checks to another server and close only the displayed owner, rejecting old-server findings', async () => {
  reset()
  const callsA = [], callsB = []
  const a = ownedLink('/work/a', 5301, callsA), b = ownedLink('/work/b', 5302, callsB)
  const serverA = fakeServer(), serverB = { ...fakeServer(), root: b.root }
  const preview = makePreview({ link: server => server === serverA ? a : b, board: () => ({ name: 'Board' }) }).preview
  await preview.finding(serverA, findingEvent(a), a)
  const checks = panels[0]
  await preview.open(serverB, '2d')
  assert.equal(new URL(iframe(checks)).origin, 'http://127.0.0.1:5302')
  const html = checks.webview.html
  await preview.finding(serverA, findingEvent(a), a)
  assert.equal(checks.webview.html, html)
  checks.dispose()
  assert.deepEqual(callsA, [])
  assert.deepEqual(callsB, [['session/select', { project: b.root, board: 'Board', refs: [], finding: null }]])
  preview.dispose()
})

test('checks navigation replaces finding ownership and manual checks participate in last-pane close', async () => {
  reset()
  const calls = [], link = ownedLink('/work/a', 5301, calls)
  const server = fakeServer()
  const preview = makePreview({ link: () => link, board: () => ({ name: 'Board' }) }).preview
  await preview.finding(server, findingEvent(link, 'assembled'), link)
  assert.equal(new URL(iframe(panels[0])).pathname, '/project/board/Board/assembled')
  await preview.showBoard(server, 'Other')
  assert.deepEqual(panels[0].posted.at(-1), { type: 'post', data: { type: 'pcbjs:view', board: 'Other', target: null } })
  await preview.open(server, 'checks', 'new')
  const html = panels[0].webview.html
  panels[0].posted.length = 0
  await preview.showBoard(server, 'Other')
  assert.equal(panels[0].webview.html, html)
  assert.equal(panels[0].posted.filter(p => p.type === 'src' || p.type === 'post').length, 0)
  panels[0].dispose()
  assert.deepEqual(calls, [])
  panels[1].dispose()
  assert.deepEqual(calls, [['session/select', { project: link.root, board: 'Other', refs: [], finding: null }]])
  await preview.open(server, 'checks')
  panels.at(-1).dispose()
  assert.equal(calls.length, 2, 'checks opened without a finding still own their displayed board')
  preview.dispose()
})

test('checks close preserves target identity and disconnected panes never mutate old sessions', async () => {
  reset()
  const calls = [], link = ownedLink('/work/a', 5301, calls)
  const server = fakeServer()
  const preview = makePreview({ link: () => link, board: () => ({ name: 'Board' }) }).preview
  await preview.finding(server, findingEvent(link, 'assembled'), link)
  panels[0].dispose()
  assert.deepEqual(calls, [['session/select', { project: link.root, board: 'Board', target: 'assembled', refs: [], finding: null }]])
  await preview.finding(server, findingEvent(link), link)
  link.open = false
  panels[1].dispose()
  assert.equal(calls.length, 1)
  preview.dispose()
})


test('cleared finding reconciles existing checks target without opening a closed pane', async () => {
  reset()
  const calls = [], link = ownedLink('/work/a', 5301, calls)
  const server = fakeServer()
  const preview = makePreview({ link: () => link, board: () => ({ name: 'Board' }) }).preview
  await preview.finding(server, { ...findingEvent(link, 'Bare PCB'), finding: null }, link)
  assert.equal(panels.length, 0)
  await preview.finding(server, findingEvent(link, 'Assembled Board'), link)
  assert.equal(new URL(iframe(panels[0])).pathname, '/project/board/Board/assembled-board')
  await preview.finding(server, { ...findingEvent(link, 'Bare PCB'), finding: null }, link)
  assert.equal(panels.length, 1)
  assert.equal(new URL(iframe(panels[0])).pathname, '/project/board/Board/bare-pcb')
  panels[0].dispose()
  assert.deepEqual(calls, [['session/select', { project: link.root, board: 'Board', target: 'Bare PCB', refs: [], finding: null }]])
  preview.dispose()
})

test('development inspector targets only active pane, keeps reload state, and refuses production commands', async () => {
  panels.length = 0
  let development = true
  const { preview } = makePreview({ devtools: () => development })
  const server = fakeServer()
  await preview.open(server, '2d')
  await preview.open(server, '3d')
  panels[0].focus()
  assert.equal(preview.devtools(), true)
  assert.deepEqual(panels[0].posted.at(-1), { type: 'post', data: { type: 'pcbjs:devtools', enabled: true } })
  assert.equal(panels[1].posted.some(p => p.data?.type === 'pcbjs:devtools'), false)
  panels[0].webview.receive({ type: 'ready' })
  assert.equal(panels[0].posted.at(-1).data.enabled, true)
  panels[0].webview.receive({ type: 'devtools', enabled: false })
  panels[0].webview.receive({ type: 'ready' })
  assert.equal(panels[0].posted.at(-1).data.enabled, false)
  panels[1].focus()
  assert.equal(preview.devtools(true), true)
  assert.equal(panels[1].posted.at(-1).data.enabled, true)
  development = false
  const count = panels[1].posted.length
  assert.equal(preview.devtools(), false)
  assert.equal(panels[1].posted.length, count)
  preview.dispose()
})
