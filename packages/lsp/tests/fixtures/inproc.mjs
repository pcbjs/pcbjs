// A language server in this process over a message channel, and a client that sends it requests and notifications.
import { pathToFileURL } from 'node:url'
import { messageChannel } from '../../dist/channel.js'
import { startLanguageServer } from '../../dist/server.js'

/** Starts a server with `start(transport)`, or a plain one on `host` and `store`, and initializes it. */
export async function inproc(start) {
  let next = 0
  const pending = new Map()
  const notes = []
  const ch = messageChannel(m => {
    if (m.id !== undefined && pending.has(m.id) && !m.method) {
      pending.get(m.id)(m.result)
      pending.delete(m.id)
    } else if (m.id !== undefined && m.method) ch.push({ jsonrpc: '2.0', id: m.id, result: null })
    else if (m.method) notes.push(m)
  })
  const server = start(ch)
  const request = (method, params) =>
    new Promise(res => {
      const id = ++next
      pending.set(id, res)
      ch.push({ jsonrpc: '2.0', id, method, params })
    })
  const notify = (method, params) => ch.push({ jsonrpc: '2.0', method, params })
  await request('initialize', { processId: null, rootUri: null, capabilities: {} })
  notify('initialized', {})
  const open = (file, text, version = 1) => notify('textDocument/didOpen', { textDocument: { uri: pathToFileURL(file).href, languageId: 'typescriptreact', version, text } })
  const change = (file, text, version) => notify('textDocument/didChange', { textDocument: { uri: pathToFileURL(file).href, version }, contentChanges: [{ text }] })
  return { server, request, notify, notes, open, change, close: () => ch.close() }
}

export const host = (extra = {}) => ({ version: '0.0.0', source: { boards: () => [] }, ...extra })
