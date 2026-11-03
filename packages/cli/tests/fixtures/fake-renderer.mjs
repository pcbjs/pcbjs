// A stand-in for render/worker.js speaking its protocol, its behaviour picked by the scene key: `trap`, `exit`, `hang`,
// `trap-once:<file>` and `exit-once:<file>` fail until the file exists, anything else answers a 1 by 1 image.
import { parentPort } from 'node:worker_threads'
import { existsSync, writeFileSync } from 'node:fs'

const once = (key, kind) => {
  if (!key.startsWith(`${kind}-once:`)) return false
  const file = key.slice(kind.length + 6)
  if (existsSync(file)) return false
  writeFileSync(file, '')
  return true
}

parentPort.on('message', m => {
  if (m.method === 'load') return parentPort.postMessage({ id: m.id, result: { key: m.key, triangles: 0 } })
  if (m.key === 'hang') return
  if (m.key === 'trap' || once(m.key, 'trap'))
    return parentPort.postMessage({ id: m.id, error: { name: 'RendererError', message: 'unreachable executed', code: 'WASM_TRAP', operation: 'render', recoverable: false } })
  if (m.key === 'exit' || once(m.key, 'exit')) process.exit(7)
  parentPort.postMessage({ id: m.id, result: { rgba: new Uint8Array([1, 2, 3, 255]), width: 1, height: 1 } })
})
