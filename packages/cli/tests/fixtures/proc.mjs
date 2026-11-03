// Child processes of a test: the port a server printed, a session on a free port, and a stop that cannot hang.
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'pcbjs', 'bin', 'pcbjs.js')

/** The port a spawned server printed as 127.0.0.1:<port>, polling the text `out()` returns. */
export async function printedPort(out, ms = 30000) {
  const end = Date.now() + ms
  for (;;) {
    const m = /127\.0\.0\.1:(\d+)/.exec(out())
    if (m && m[1] !== '0') return Number(m[1])
    if (Date.now() > end) throw new Error(`the server did not start:\n${out()}`)
    await new Promise(r => setTimeout(r, 50))
  }
}

/** SIGTERM, then SIGKILL after `ms`; resolves once the child exited. */
export async function stop(child, ms = 5000) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise(r => child.once('exit', r))
  child.kill('SIGTERM')
  const timer = setTimeout(() => child.kill('SIGKILL'), ms)
  await exited
  clearTimeout(timer)
}

/** `pcbjs session serve -p 0` in `root`, its socket under `root/.run`; resolves once it wrote dev.json, with its port and a stop. */
export async function serveSession(root, args = [], ms = 60000) {
  const env = { ...process.env, XDG_RUNTIME_DIR: join(root, '.run'), NO_COLOR: '1' }
  const child = spawn(process.execPath, [BIN, 'session', 'serve', '-p', '0', '--host', '127.0.0.1', ...args], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  child.stdout.on('data', d => (out += d))
  child.stderr.on('data', d => (out += d))
  const end = Date.now() + ms
  while (!/\[pcbjs\] session \w+, pid/.test(out)) {
    if (Date.now() > end || child.exitCode !== null) throw new Error(`the session did not start:\n${out}`)
    await new Promise(r => setTimeout(r, 50))
  }
  const info = JSON.parse(readFileSync(join(root, '.pcbjs', 'dev.json'), 'utf8'))
  return { child, info, port: Number(new URL(info.url).port), log: () => out, stop: () => stop(child) }
}
