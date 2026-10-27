// A language client for the tests: vscode-jsonrpc over a WebSocket to the dev server, each message a `pcbjs:lsp` event on
// Vite's socket, the way the dev.json fallback carries it.
import WebSocket from 'ws'
import { createMessageConnection } from 'vscode-jsonrpc'
import { messageChannel } from '../../dist/channel.js'

export async function viteClient(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/`, 'vite-hmr')
  await new Promise((ok, fail) => { ws.once('open', ok); ws.once('error', fail) })
  const ch = messageChannel(msg => ws.send(JSON.stringify({ type: 'custom', event: 'pcbjs:lsp', data: msg })))
  ws.on('message', raw => {
    let m
    try { m = JSON.parse(raw.toString()) } catch { return }
    if (m?.type === 'custom' && m.event === 'pcbjs:lsp') ch.push(m.data)
  })
  ws.on('close', () => ch.close())
  const conn = createMessageConnection(ch.reader, ch.writer)
  conn.listen()
  return { ws, conn, close: () => { conn.dispose(); ws.close() } }
}

export const ALL_KINDS = ['number', 'length', 'angle', 'position', 'layer', 'enum', 'pathCommand', 'pinRef']

export function initParams(root, pcbjs = { protocol: 1, kinds: ALL_KINDS, name: 'test', version: '0' }) {
  return {
    processId: null,
    rootUri: null,
    workspaceFolders: [{ uri: `file://${root}`, name: 'fixture' }],
    capabilities: { workspace: { codeLens: { refreshSupport: true }, inlayHint: { refreshSupport: true } } },
    ...(pcbjs ? { initializationOptions: { pcbjs } } : {}),
  }
}

/** A promise that resolves with the first value `pred` accepts, from a handler registered now. */
export function waitFor(register, pred = () => true, ms = 20000) {
  return new Promise((ok, fail) => {
    const t = setTimeout(() => fail(new Error('timed out')), ms)
    register(v => { if (pred(v)) { clearTimeout(t); ok(v) } })
  })
}

/** Apply LSP text edits to a text, last first. */
export function applyEdits(text, edits) {
  const starts = [0]
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1)
  const off = p => starts[p.line] + p.character
  const sorted = [...edits].sort((a, b) => off(b.range.start) - off(a.range.start))
  for (const e of sorted) text = text.slice(0, off(e.range.start)) + e.newText + text.slice(off(e.range.end))
  return text
}

/** The LSP position of the n-th occurrence of `needle`, plus `delta` characters. */
export function posOf(text, needle, delta = 0, n = 0) {
  let at = -1
  for (let k = 0; k <= n; k++) at = text.indexOf(needle, at + 1)
  if (at < 0) throw new Error(`${needle} not found`)
  at += delta
  const before = text.slice(0, at)
  const line = before.split('\n').length - 1
  return { line, character: at - (before.lastIndexOf('\n') + 1) }
}
