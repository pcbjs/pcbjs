// The edit path end to end: a real `pcbjs session serve` on a scratch copy of the demo, the extension's own wiring of server, owner,
// handoff and sync with a fake VS Code editor and language client, and the viewer page in a headless Chromium driven through its DOM. Each gesture of the
// interaction contract's edit table writes once through the editor's applyEdit at the point of instantiation, leaves the file on
// disk alone until a save, compiles once and shows the chip's confirmation; with no editor the same gesture writes to disk.
// Skipped with a notice without a Chromium; PCBJS_E2E_PORT and PCBJS_E2E_DEVTOOLS pin the ports, else free ones; PCBJS_E2E_SHOTS names a
// folder for the page's screenshots of Blinky's CH1 selected and dragged.
import { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromes, launchAny, stopChrome, cdp, evaluate } from '../../../scripts/browser-equality.mjs'

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
export const BIN = join(REPO, 'packages', 'pcbjs', 'bin', 'pcbjs.js')
export const VSC = join(REPO, 'packages', 'vscode')
export const skip = process.platform === 'win32' ? 'the edit path runs on Linux and macOS' : chromes().length ? false : 'no Chromium found; set PCBJS_CHROME to one'
export const sleep = ms => new Promise(r => setTimeout(r, ms))
export const debug = process.env.PCBJS_E2E_DEBUG ? (...a) => console.error('[e2e]', ...a) : () => {}

export async function until(what, fn, ms = 15000) {
  const end = Date.now() + ms
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() > end) {
      if (process.env.PCBJS_E2E_LOG && S) writeFileSync(process.env.PCBJS_E2E_LOG, S.log.text)
      throw new Error(
        `timed out waiting for ${what}${page ? `; chip: ${JSON.stringify(await confirmations().catch(() => []))}, toasts: ${JSON.stringify(await toasts().catch(() => []))}` : ''}`,
      )
    }
    await sleep(40)
  }
}

/** The extension's bundles, built again when a source is newer than them. */
export function vscodeDist() {
  const out = join(VSC, 'dist', 'server.cjs')
  const newest = dir => Math.max(...readdirSync(dir).map(f => statSync(join(dir, f)).mtimeMs))
  if (existsSync(out) && statSync(out).mtimeMs >= newest(join(VSC, 'src'))) return
  const r = spawnSync(process.execPath, [join(VSC, 'scripts', 'build.mjs')], { cwd: VSC, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`the extension did not build:\n${r.stdout}${r.stderr}`)
}

export const children = []
export const dirs = []
export let watchdog
// a run that hangs fails here instead of at the package's ten minute limit, its children stopped
export const LIMIT = Number(process.env.PCBJS_E2E_MS ?? 300000)

/** A scratch copy of the demo with Quad its only entry, @pcbjs linked from the repository. */
export function project() {
  const top = realpathSync(mkdtempSync(join(tmpdir(), 'pcbjs-edit-')))
  dirs.push(top)
  const root = join(top, 'demo')
  const from = join(REPO, 'examples', 'demo')
  cpSync(from, root, { recursive: true, filter: f => !/\/(node_modules|\.pcbjs)(\/|$)/.test(f.slice(from.length)) })
  mkdirSync(join(root, 'node_modules'))
  symlinkSync(join(REPO, 'node_modules', '@pcbjs'), join(root, 'node_modules', '@pcbjs'), 'dir')
  const cfg = join(root, 'pcb.config.ts')
  writeFileSync(cfg, readFileSync(cfg, 'utf8').replace(/entries: \[[^\]]*\]/, "entries: ['quad.pcb.tsx', 'blinky.pcb.tsx']"))
  return { top, root }
}

/** `pcbjs session serve` in the project, its output kept; resolves with its dev.json. */
export async function serve(root, run, args = []) {
  const port = process.env.PCBJS_E2E_PORT ?? '0'
  const child = spawn(process.execPath, [BIN, 'session', 'serve', ...args, '--port', port, '--host', '127.0.0.1'], {
    cwd: root,
    env: { ...process.env, XDG_RUNTIME_DIR: run, NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  children.push(child)
  const log = { text: '' }
  child.stdout.on('data', d => (log.text += d))
  child.stderr.on('data', d => (log.text += d))
  await until('the session', () => /\[pcbjs\] session \w+, pid/.test(log.text), 30000)
  return { child, log, dev: JSON.parse(readFileSync(join(root, '.pcbjs', 'dev.json'), 'utf8')) }
}

export let S, page, chrome, ed, quad, TEXT0
/** The WebSockets the page opened, by request id: the URL and how many of their frames speak pcbjs. */
export const sockets = new Map()

/** The fake VS Code editor around the extension's own wiring: the server, its links, the owner of each file, the document handoff and Sync as the extension runs them, with the language client over each link as vscode-languageclient runs it. */
export async function editor(root, file) {
  vscodeDist()
  const fake = await import(pathToFileURL(join(VSC, 'tests', 'vscode.mjs')).href)
  const require = createRequire(join(VSC, 'package.json'))
  const { Wiring } = require('./dist/wiring.cjs')
  const { PcbjsSession, transports, initializationOptions } = require('./dist/lsp-client.cjs')
  const { createMessageConnection } = require('vscode-jsonrpc/node')
  const { vscode } = fake
  const out = { applied: [], refused: [], selects: [], notices: [], fake, session: null, sync: null, server: null }
  const versions = new Map()
  const uriOf = d => d.uri.toString()
  const port = {
    select: p => {
      out.selects.push(p)
      const doc = fake.docs.find(d => d.uri.toString() === p.primary.uri)
      const ed = fake.editors.find(e => e.document === doc)
      const r = p.items.find(i => i.uri === p.primary.uri)?.ranges[p.primary.index]
      if (ed && r) ed.selections = [new vscode.Selection(new vscode.Position(r.start.line, r.start.character), new vscode.Position(r.end.line, r.end.character))]
    },
    preview: () => {},
    applyEdit: async () => false,
    uri: f => vscode.Uri.file(f).toString(),
  }
  /** vscode-languageclient over a link: it answers workspace/applyEdit with vscode.workspace.applyEdit of the converted edit, refusing one made on a version of an open document it has passed */
  const language = async link => {
    const t = transports(link)
    const conn = createMessageConnection(t.reader, t.writer)
    conn.onRequest('workspace/applyEdit', async p => {
      const stale = (p.edit.documentChanges ?? []).some(c => {
        const uri = c.textDocument && vscode.Uri.parse(c.textDocument.uri).toString()
        return c.textDocument?.version >= 0 && versions.has(uri) && versions.get(uri) !== c.textDocument.version
      })
      if (stale) {
        out.refused.push(p.edit)
        return { applied: false }
      }
      const edit = new vscode.WorkspaceEdit()
      const add = (uri, edits) => {
        for (const e of edits)
          edit.replace(vscode.Uri.parse(uri), new vscode.Range(e.range.start.line, e.range.start.character, e.range.end.line, e.range.end.character), e.newText)
      }
      for (const [uri, edits] of Object.entries(p.edit.changes ?? {})) add(uri, edits)
      for (const c of p.edit.documentChanges ?? []) if (c.textDocument) add(c.textDocument.uri, c.edits)
      out.applied.push(p.edit)
      return { applied: await vscode.workspace.applyEdit(edit) }
    })
    conn.onRequest('client/registerCapability', () => null)
    conn.onRequest('workspace/configuration', p => p.items.map(() => null))
    conn.onNotification((m, p) => debug('lsp', m, JSON.stringify(p).slice(0, 200)))
    conn.listen()
    await conn.sendRequest('initialize', {
      processId: process.pid,
      rootUri: pathToFileURL(root).href,
      workspaceFolders: [{ uri: pathToFileURL(root).href, name: 'demo' }],
      capabilities: {
        workspace: { applyEdit: true, workspaceEdit: { documentChanges: true, resourceOperations: ['create', 'rename', 'delete'] } },
        textDocument: { synchronization: { didSave: true } },
      },
      initializationOptions: initializationOptions('0.0.1-test'),
    })
    await conn.sendNotification('initialized', {})
    const session = new PcbjsSession(conn, port)
    const lsp = {
      session,
      peer: { alive: () => link.open && link.lsp === lsp, notify: (m, p) => void conn.sendNotification(m, p) },
      dispose: async () => {
        session.dispose()
        conn.dispose()
      },
    }
    return lsp
  }
  const w = new Wiring({
    folders: () => [root],
    name: 'vscode-pcbjs',
    version: '0.0.1-test',
    language,
    docs: () => fake.docs.map(d => ({ uri: uriOf(d), languageId: 'typescriptreact', version: versions.get(uriOf(d)) ?? 1, text: d.getText() })),
    onMismatch: n => out.notices.push(n),
    output: line => debug('ext', line),
  })
  out.server = w.server
  out.sync = w.sync
  await w.server.start()
  await until('the language client', () => w.server.client?.lsp)
  /** the client of the session that owns a document, as the handoff left it */
  const peerOf = d => w.server.owner(d.uri.fsPath)?.link.lsp?.peer
  // the document sync of the language client: every change in full as the server asks, save; `hold` keeps the changes back as a slow link would
  const held = []
  vscode.workspace.onDidChangeTextDocument(({ document: d }) => {
    const v = (versions.get(uriOf(d)) ?? 1) + 1
    versions.set(uriOf(d), v)
    const change = { textDocument: { uri: uriOf(d), version: v }, contentChanges: [{ text: d.getText() }] }
    if (out.holding) held.push([d, change])
    else peerOf(d)?.notify('textDocument/didChange', change)
  })
  out.hold = () => (out.holding = true)
  out.release = () => {
    out.holding = false
    for (const [d, c] of held.splice(0)) peerOf(d)?.notify('textDocument/didChange', c)
  }
  vscode.workspace.onDidSaveTextDocument(d => peerOf(d)?.notify('textDocument/didSave', { textDocument: { uri: uriOf(d) } }))
  /** A file opened as the editor opens it, the handoff giving it to the session that owns it. */
  const open = f => {
    const opened = fake.openDoc(f, readFileSync(f, 'utf8'))
    versions.set(uriOf(opened.doc), 1)
    w.handoff()
    return opened
  }
  const { doc, editor: textEditor } = open(file)
  out.session = w.sessionOf(file)
  out.doc = doc
  out.editor = textEditor
  out.link = w.server.owner(file).link
  /** The cursor at a 1-based line and column, as the extension reports a selection change. */
  out.cursor = (line, col) => {
    textEditor.selections = [new vscode.Selection(new vscode.Position(line - 1, col - 1), new vscode.Position(line - 1, col - 1))]
    out.sync.cursor(file, line, col, [{ start: { line: line - 1, character: col - 1 }, end: { line: line - 1, character: col - 1 } }])
  }
  /** A keystroke that replaces the text, as typing does. */
  out.type = text => doc.type(text)
  /** Another file opened beside the first. */
  out.open = async other => open(other).doc
  out.close = () => w.dispose()
  return out
}

// ---- the page ----
export const ev = expr => evaluate(page, expr)
/** A board point of the 2D view on screen, in CSS pixels. */
export const screenOf = async (x, y) =>
  ev(`(() => { const m = document.querySelector('svg.board-svg g.layer').getScreenCTM(); return [m.a * ${x} + m.c * ${y} + m.e, m.b * ${x} + m.d * ${y} + m.f] })()`)
export const mouse = (type, [x, y], o = {}) =>
  page.send('Input.dispatchMouseEvent', {
    type,
    x,
    y,
    button: type === 'mouseMoved' && !o.held ? 'none' : 'left',
    buttons: o.held || type === 'mousePressed' ? 1 : 0,
    clickCount: type === 'mouseMoved' ? 0 : 1,
    modifiers: o.modifiers ?? 0,
  })
export async function click(at, o) {
  await mouse('mouseMoved', at, o)
  await mouse('mousePressed', at, o)
  await mouse('mouseReleased', at, o)
}
export async function dblclick([x, y]) {
  await mouse('mouseMoved', [x, y])
  for (const clickCount of [1, 2]) {
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount })
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount })
  }
}
/** A press, moves in steps to the end, and a release, as a hand drags. */
export async function drag(from, to, o = {}) {
  await mouse('mouseMoved', from)
  await mouse('mousePressed', from, o)
  for (let i = 1; i <= 8; i++) {
    await mouse('mouseMoved', [from[0] + ((to[0] - from[0]) * i) / 8, from[1] + ((to[1] - from[1]) * i) / 8], { ...o, held: true })
    await sleep(16)
  }
  await mouse('mouseReleased', to, o)
}
export async function key(k, code, modifiers = 0) {
  const vk = { Delete: 46, Escape: 27 }[k] ?? k.toUpperCase().charCodeAt(0)
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, modifiers, windowsVirtualKeyCode: vk })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, modifiers, windowsVirtualKeyCode: vk })
}
/** The centre of the first element a selector names, once there is one. */
export const centre = sel =>
  until(sel, () =>
    ev(
      `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] })()`,
    ),
  )
export const chip = () => ev(`document.querySelector('.chips-bar')?.innerText ?? ''`)
/** Every confirmation the chip showed since the page loaded, in order. */
export const confirmations = () => ev(`window.__written ?? []`)
/** Every toast since the page loaded, the errors the tools report. */
export const toasts = () => ev(`window.__toasts ?? []`)
export const WATCH_WRITTEN = `window.__written = []
window.__toasts = []
new MutationObserver(ms => {
  for (const m of ms)
    for (const n of m.addedNodes) {
      if (n.nodeType !== 1) continue
      if (n.matches('.selection-status[role="status"]')) window.__written.push(n.textContent.trim())
      if (n.matches('.toast')) window.__toasts.push(n.textContent.trim())
    }
}).observe(document.body, { childList: true, subtree: true })`
export const snapshot = () => ev(`document.querySelector('svg.board-svg')?.dataset.snapshot ?? ''`)

/** The compiles of a board the session logged so far, Quad's by default. */
export const compiles = (board = 'Quad') => (S.log.text.match(new RegExp(`${board} 0\\.1\\.0 .*DRC|${board.toLowerCase()}\\.pcb\\.tsx: compiled `, 'g')) ?? []).length

/** No compile for 600 ms, so a gesture counts only its own. */
export async function settled(board) {
  let n = compiles(board),
    t = Date.now()
  while (Date.now() - t < 600) {
    await sleep(50)
    if (compiles(board) !== n) ((n = compiles(board)), (t = Date.now()))
  }
}

/** One gesture on a board's entry, Quad's by default: its applyEdits, the compile and the chip's confirmation after it. */
export async function gesture(name, act, { board = 'Quad', file = quad } = {}) {
  await settled(board)
  const before = { applied: ed.applied.length, compiles: compiles(board), disk: readFileSync(file, 'utf8'), log: S.log.text.length, shown: (await confirmations()).length }
  await act()
  await until(`${name}: an applyEdit`, () => ed.applied.length > before.applied)
  await until(`${name}: a compile`, () => compiles(board) > before.compiles, 20000)
  await until(`${name}: the chip's confirmation`, async () => (await confirmations()).length > before.shown)
  await sleep(600)
  assert.deepEqual((await confirmations()).slice(before.shown), ['Updated'], `${name}: one confirmation`)
  assert.equal(ed.applied.length - before.applied, 1, `${name}: one applyEdit`)
  assert.equal(compiles(board) - before.compiles, 1, `${name}: one compile\n${S.log.text.slice(before.log)}`)
  assert.equal(readFileSync(file, 'utf8'), before.disk, `${name}: the file on disk is unchanged until a save`)
  return ed.applied.at(-1)
}

/** The page on a board's 2D view, the chip's confirmations watched again. */
export async function show(board, ref) {
  await page.send('Page.navigate', { url: new URL(`board/${board}?view=2d`, S.dev.url).href })
  await until(`the 2D view of ${board}`, () => ev(`!!document.querySelector('svg.board-svg g.layer [data-ref="${ref}"]')`).catch(() => false), 30000)
  await ev(WATCH_WRITTEN)
  await sleep(500)
}

/** A screenshot of the page into PCBJS_E2E_SHOTS, when it is set. */
export async function shot(name) {
  const dir = process.env.PCBJS_E2E_SHOTS
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(dir, `${name}.png`), Buffer.from(data, 'base64'))
}

/** A point on the strokes of the text drawn nearest a board point, on screen: the centre of a stroked text can fall between strokes. */
export const onText = async (x, y) => {
  const [sx, sy] = await screenOf(x, y)
  return ev(`(() => {
    let best = null
    for (const e of document.querySelectorAll('svg.board-svg g.layer [data-kind="text"]')) {
      if (typeof e.getPointAtLength !== 'function') continue
      const p = e.getPointAtLength(e.getTotalLength() / 3), m = e.getScreenCTM()
      const q = [m.a * p.x + m.c * p.y + m.e, m.b * p.x + m.d * p.y + m.f]
      const d = Math.hypot(q[0] - ${sx}, q[1] - ${sy})
      if (!best || d < best.d) best = { d, q }
    }
    return best && best.q
  })()`)
}

/** Every 50 ms from the release on, the left edge on screen of a part's pads as drawn, the hidden ones left out. */
export const SAMPLE = ref => `(() => {
  const x = () => {
    const xs = [...document.querySelectorAll('svg.board-svg g.layer [data-ref="${ref}"][data-kind="pad"]')]
      .filter(e => getComputedStyle(e).display !== 'none')
      .map(e => e.getBoundingClientRect())
      .filter(r => r.width > 0)
      .map(r => r.x)
    return xs.length ? Math.min(...xs) : null
  }
  window.__x0 = x()
  window.__xs = []
  addEventListener('pointerup', () => {
    const t = setInterval(() => window.__xs.push(x()), 50)
    setTimeout(() => clearInterval(t), 4000)
  }, { once: true, capture: true })
})()`

/** A part's body in the 3D view: its world x and y in board mm, y down, and where it is on screen; null while it has none. */
export const BODY = ref => `(() => {
  const k = window.__pcbjs3d
  if (!k) return null
  const g = k.groups.get('bodies:F')
  const o = g && g.children.find(c => c.userData.ref === ${JSON.stringify(ref)})
  if (!o || !o.children[0]) return null
  k.scene.updateMatrixWorld()
  const v = o.children[0].getWorldPosition(new o.position.constructor())
  const at = [v.x, -v.y]
  const s = v.clone().project(k.camera)
  const r = document.querySelector('.view3d-host canvas').getBoundingClientRect()
  return { at, screen: [r.x + ((s.x + 1) / 2) * r.width, r.y + ((1 - s.y) / 2) * r.height] }
})()`
/** The screen point of a board point in the plane at the height of a body's origin, in the 3D view. */
export const SCREEN3 = (ref, x, y) => `(() => {
  const k = window.__pcbjs3d
  const o = k.groups.get('bodies:F').children.find(c => c.userData.ref === ${JSON.stringify(ref)})
  const v = o.children[0].getWorldPosition(new o.position.constructor())
  v.x = ${x}
  v.y = -${y}
  const s = v.project(k.camera)
  const r = document.querySelector('.view3d-host canvas').getBoundingClientRect()
  return [r.x + ((s.x + 1) / 2) * r.width, r.y + ((1 - s.y) / 2) * r.height]
})()`

/** `session/select` of Blinky's CH1 through the extension's link: the editor's cursor selects `<LedChannelRow g={CH1} at="16 5" label="LED1" />`. */
export async function instanceJump(e, root) {
  const n = e.selects.length
  await e.link.request('session/select', { board: 'Blinky', refs: ['CH1'], anchor: 'CH1' })
  await until('pcbjs/select for CH1', () => e.selects.length > n)
  const s = e.selects.at(-1)
  const item = s.items.find(i => i.uri === s.primary.uri)
  assert.equal(item.uri, pathToFileURL(join(root, 'blinky.pcb.tsx')).href)
  const r = item.ranges[s.primary.index]
  const line = readFileSync(join(root, 'blinky.pcb.tsx'), 'utf8').split('\n')[r.start.line]
  assert.match(line, /<LedChannelRow g=\{CH1\} at="16 5" label="LED1" \/>/)
  assert.equal(line.slice(r.start.character, r.end.character), '<LedChannelRow g={CH1} at="16 5" label="LED1" />')
}

export function harness() {
  before(async () => {
    if (skip) return
    watchdog = setTimeout(() => {
      console.error(`edit-path: still running after ${LIMIT} ms, stopped`)
      for (const c of children) c.kill('SIGKILL')
      chrome?.proc.kill('SIGKILL')
      process.exit(1)
    }, LIMIT)
    watchdog.unref()
    const { top, root } = project()
    quad = join(root, 'quad.pcb.tsx')
    TEXT0 = readFileSync(quad, 'utf8')
    const run = join(top, 'run')
    mkdirSync(run)
    S = await serve(root, run)
    chrome = await launchAny(chromes(), top, Number(process.env.PCBJS_E2E_DEVTOOLS ?? 0))
    children.push(chrome.proc)
    page = await cdp(chrome.socket)
    await page.send('Runtime.enable')
    await page.send('Network.enable')
    page.on('Network.webSocketCreated', p => sockets.set(p.requestId, { url: p.url, pcbjs: 0 }))
    const seen = (dir, p) => {
      const text = p.response.payloadData
      const w = sockets.get(p.requestId)
      if (w && (text.includes('pcbjs:') || text.includes('session/'))) w.pcbjs++
      if (/pcbjs:select|session\/select|session\/observe/.test(text)) debug(dir, text.slice(0, 300))
    }
    page.on('Network.webSocketFrameReceived', p => seen('in', p))
    page.on('Network.webSocketFrameSent', p => seen('out', p))
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false })
    ed = await editor(root, quad)
    await page.send('Page.navigate', { url: new URL('board/Quad?view=2d', S.dev.url).href })
    await until('the 2D view', () => ev(`!!document.querySelector('svg.board-svg g.layer [data-ref="J1"]')`).catch(() => false), 30000)
    // the view draws from the first facets before the compile's line is logged, which a gesture would count as its own
    await until('the first compiles logged', () => compiles('Quad') && compiles('Blinky'), 60000)
    await ev(WATCH_WRITTEN)
    await sleep(500)
  })

  after(async () => {
    clearTimeout(watchdog)
    if (process.env.PCBJS_E2E_LOG && S) writeFileSync(process.env.PCBJS_E2E_LOG, S.log.text)
    await ed?.close().catch(() => {})
    page?.close()
    await stopChrome(chrome?.proc)
    for (const c of children) c.kill('SIGKILL')
    for (const d of dirs) rmSync(d, { recursive: true, force: true })
  })
}
