// A chord the viewer did not take in a pane, cmd or ctrl P among them, reaches VS Code: the pane page dispatches it again on its own
// document, where VS Code's webview host listens for keydown and hands it to the workbench; a key from anywhere but the viewer is ignored.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { panels } from './vscode.mjs'

const require = createRequire(import.meta.url)
const { Preview } = require('../dist/preview.cjs')

const server = () => ({
  root: '/work/demo',
  name: 'demo',
  active: true,
  state: { kind: 'running', url: 'http://127.0.0.1:5301/' },
  boards: { boards: [{ name: 'Blinky', title: 'Blinky', entry: 'blinky.pcb.tsx' }], root: '/work/demo' },
  scope: undefined,
  page: undefined,
  recent: () => [],
})

/** The pane page's own script run against a document that records what is dispatched on it. */
function runPage(html) {
  const scripts = [...html.matchAll(/<script nonce="[^"]+">([\s\S]*?)<\/script>/g)].map(m => m[1])
  const frames = []
  const received = []
  const makeFrame = () => {
    const frame = {
      contentWindow: { postMessage: (data, origin) => received.push({ frame, data, origin }) },
      src: 'http://127.0.0.1:5301/board/Blinky',
      cloneNode: () => makeFrame(),
      replaceWith() {},
    }
    frames.push(frame)
    return frame
  }
  const frame = makeFrame()
  const listeners = {}
  const dispatched = []
  const posted = []
  class KeyboardEvent {
    constructor(type, init) {
      Object.assign(this, { type, defaultPrevented: false }, init)
    }
  }
  const document = {
    getElementById: id => (id === 'viewer' ? frame : { textContent: '' }),
    dispatchEvent: e => (dispatched.push(e), true),
  }
  const ctx = vm.createContext({
    document,
    KeyboardEvent,
    URL,
    innerWidth: 800,
    innerHeight: 600,
    acquireVsCodeApi: () => ({ postMessage: m => posted.push(m), setState() {} }),
    addEventListener: (type, fn) => (listeners[type] ??= []).push(fn),
  })
  vm.runInContext(scripts.at(-1), ctx)
  const message = (data, source) => listeners.message.forEach(fn => fn({ data, source }))
  return { frame, frames, received, dispatched, posted, message }
}

test('a chord from the viewer is dispatched again on the pane page, unhandled, for VS Code to take', async () => {
  panels.length = 0
  const p = new Preview({ ensureStarted: async () => {}, board: () => undefined, onChange: () => {}, icon: { light: 'l.svg', dark: 'd.svg' } })
  await p.open(server(), '2d')
  const page = runPage(panels[0].webview.html)
  page.message({ type: 'pcbjs:key', key: 'p', code: 'KeyP', keyCode: 80, metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, repeat: false }, page.frame.contentWindow)
  page.message({ type: 'pcbjs:key', key: 'P', code: 'KeyP', keyCode: 80, metaKey: false, ctrlKey: true, altKey: false, shiftKey: true, repeat: false }, page.frame.contentWindow)
  assert.equal(page.dispatched.length, 2)
  const [cmdP, ctrlShiftP] = page.dispatched
  assert.equal(cmdP.type, 'keydown')
  assert.deepEqual(
    { key: cmdP.key, code: cmdP.code, keyCode: cmdP.keyCode, metaKey: cmdP.metaKey, bubbles: cmdP.bubbles, cancelable: cmdP.cancelable, defaultPrevented: cmdP.defaultPrevented },
    { key: 'p', code: 'KeyP', keyCode: 80, metaKey: true, bubbles: true, cancelable: true, defaultPrevented: false },
  )
  assert.ok(ctrlShiftP.ctrlKey && ctrlShiftP.shiftKey && !ctrlShiftP.metaKey)
  assert.deepEqual(
    page.posted.filter(m => m.type !== 'size'),
    [],
    'nothing goes to the extension itself',
  )
  page.message({ type: 'pcbjs:key', key: 'p', metaKey: true }, {})
  assert.equal(page.dispatched.length, 2, 'a key from another window is ignored')
})

test('project navigation queues selection for the new frame and rejects an old duplicate-board ready', async () => {
  panels.length = 0
  const p = new Preview({ ensureStarted: async () => {}, board: () => undefined, onChange: () => {}, icon: { light: 'l.svg', dark: 'd.svg' } })
  await p.open(server(), '2d')
  const page = runPage(panels[0].webview.html)
  page.message({ type: 'pcbjs:ready', board: 'Same' }, page.frame.contentWindow)
  page.message({ type: 'src', src: 'http://127.0.0.1:5301/a/board/Same' }, {})
  const request = { type: 'pcbjs:finding', board: 'Same', target: 'second', id: 'drc:same:000000000001' }
  page.message({ type: 'post', data: request }, {})
  assert.equal(page.received.length, 0)
  page.message({ type: 'pcbjs:ready', board: 'Same' }, page.frame.contentWindow)
  assert.equal(page.received.length, 0, 'old scope cannot flush new scope selection')
  const next = page.frames.at(-1)
  page.message({ type: 'pcbjs:ready', board: 'Same' }, next.contentWindow)
  assert.equal(page.received.length, 1)
  assert.equal(page.received[0].frame, next)
  assert.equal(page.received[0].data, request)
})
