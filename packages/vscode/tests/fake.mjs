// Test doubles shared by the link and server tests: a fake child process, a recording spawn and a mock session socket.
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { createServer } from 'node:net'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let nextPid = 40000

export class FakeChild extends EventEmitter {
  constructor({ obeysTerm = true } = {}) {
    super()
    this.pid = nextPid++
    this.stdout = new PassThrough()
    this.stderr = new PassThrough()
    this.signals = []
    this.exited = false
    this.obeysTerm = obeysTerm
  }
  kill(signal = 'SIGTERM') {
    this.signals.push(signal)
    if (signal === 'SIGKILL' || this.obeysTerm) setImmediate(() => this.exit(null, signal))
    return true
  }
  exit(code, signal = null) {
    if (this.exited) return
    this.exited = true
    this.stdout.end()
    this.stderr.end()
    this.emit('exit', code, signal)
  }
}

/** A spawn that records every call and hands out FakeChild instances. */
export function fakeSpawn(opts = {}) {
  const calls = []
  const spawn = (command, args, options) => {
    const child = new FakeChild(opts)
    calls.push({ command, args, options, child, at: Date.now() })
    return child
  }
  return { spawn, calls }
}

export const sleep = ms => new Promise(r => setTimeout(r, ms))

export async function until(fn, ms = 2000) {
  const t0 = Date.now()
  while (!(await fn())) {
    if (Date.now() - t0 > ms) throw new Error('timed out')
    await sleep(5)
  }
}

/** A session on a UNIX socket that answers hello with `ready`, unless null; each frame of the client reaches `frames` and `onFrame`. */
export async function mockSession(ready, onFrame = () => {}) {
  const socket = join(mkdtempSync(join(tmpdir(), 'pcbjs-mock-')), 's')
  const frames = []
  const conns = new Set()
  const send = m => {
    for (const c of conns) c.write(JSON.stringify(m) + '\n')
  }
  const server = createServer(c => {
    conns.add(c)
    c.on('close', () => conns.delete(c))
    c.on('error', () => {})
    let rest = ''
    c.on('data', d => {
      rest += d
      let nl
      while ((nl = rest.indexOf('\n')) >= 0) {
        const m = JSON.parse(rest.slice(0, nl))
        rest = rest.slice(nl + 1)
        frames.push(m)
        if (m.event === 'pcbjs:ide:hello' && ready) send({ event: 'pcbjs:ide:ready', data: ready })
        onFrame(m, send)
      }
    })
  })
  await new Promise(r => server.listen(socket, r))
  return {
    socket,
    get connections() { return conns.size },
    frames,
    send,
    dev: { session: 'mock0001', pid: process.pid, root: ready?.root ?? '/work/p', url: 'http://127.0.0.1:1/', socket },
    /** every connection cut, the server still listening */
    drop: () => conns.forEach(c => c.destroy()),
    close: () => new Promise(r => (conns.forEach(c => c.destroy()), server.close(() => r()))),
  }
}
