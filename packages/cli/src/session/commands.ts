// `pcbjs dev` as starter and follower, and `pcbjs session serve|stop|status`. docs/session.md has the lifecycle.
import { spawn } from 'node:child_process'
import { closeSync, openSync, readSync, statSync } from 'node:fs'
import { connectSession, type SessionConn } from './client.js'
import { ensureSession, liveSession, repoSession, alive } from './start.js'
import { serveSession, type ServeOptions } from './serve.js'
import { real } from './paths.js'
import type { EditMode, SessionInfo } from './frames.js'
import { resolveConfig } from '../project/config.js'

/** ms after a first Ctrl-C in which a second one stops the session */
const AGAIN_MS = 2000

export async function sessionServe(o: ServeOptions): Promise<number> {
  const s = await serveSession(o)
  if (!s) return 0
  await s.done
  return 0
}

export interface DevCommand {
  /** one project, the working directory, with these entries and config; or folders with `workspace` */
  args: string[]
  workspace: boolean
  config?: string
  port?: number
  host?: string | boolean
  open?: boolean
  edit?: EditMode
  grace?: number
  verbose?: boolean
  uiSrc?: string
}

/** The `session serve` arguments for the flags of `pcbjs dev`. */
export function serveArgs(o: DevCommand): string[] {
  const out = o.workspace ? ['--workspace', ...o.args] : [...o.args]
  if (o.config) out.push('--config', o.config)
  if (o.port !== undefined) out.push('--port', String(o.port))
  if (o.host === true) out.push('--host')
  else if (typeof o.host === 'string') out.push('--host', o.host)
  if (o.edit) out.push('--edit', o.edit)
  if (o.grace !== undefined) out.push('--grace', String(o.grace))
  if (o.verbose) out.push('--verbose')
  if (o.uiSrc) out.push('--ui-src', o.uiSrc)
  return out
}

/** `pcbjs dev`: ensure the session, print its URLs, follow its log, hold a cli connection; Ctrl-C detaches, twice within 2 s stops it. */
export async function devCommand(o: DevCommand): Promise<number> {
  const root = real(o.workspace ? (o.args[0] ?? '.') : '.')
  // a bad config or entry fails here, as before the session
  if (!o.workspace) await resolveConfig(o.args, 'serve', o.config, root, () => {})
  let { info, started, joined } = await ensureSession(root, { args: serveArgs(o) })
  let conn = await connectSession(info.socket, { name: 'pcbjs dev', role: 'cli', project: root, token: info.token, capabilities: ['findings'] })
  const status = await conn.request('session/status')
  print(info, conn, started, joined, o)
  if (o.open) openBrowser(info.url)
  let stopFollow = follow(status.log)
  let detaching = false
  let byeReason: string | null = null
  const watchBye = (c: SessionConn) => c.onEvent((e, d: any) => e === 'pcbjs:ide:bye' && (byeReason = String(d?.reason ?? 'stopped')))
  watchBye(conn)
  return new Promise<number>(done => {
    let first = 0
    const onInt = async () => {
      if (first && Date.now() - first < AGAIN_MS) {
        process.off('SIGINT', onInt)
        console.log(`\n  stopping session ${info.session}`)
        await stopSession(info).catch(() => {})
        stopFollow()
        done(0)
        return
      }
      first = Date.now()
      detaching = true
      conn.close()
      console.log(`\n  session ${info.session} keeps running, idle for ${status.grace} s at most; pcbjs session stop ends it, or Ctrl-C again within 2 s`)
      setTimeout(() => {
        stopFollow()
        process.off('SIGINT', onInt)
        done(0)
      }, AGAIN_MS).unref()
    }
    process.on('SIGINT', onInt)
    let reattached = false
    const onDone = async () => {
      if (detaching) return
      // a session that said bye was stopped on purpose; one that vanished is replaced once
      if (byeReason || reattached) {
        stopFollow()
        console.log(`  session ${info.session} ended${byeReason ? `: ${byeReason}` : ''}`)
        process.off('SIGINT', onInt)
        done(byeReason ? 0 : 1)
        return
      }
      reattached = true
      console.log(`  session ${info.session} went away; attaching to the next one`)
      try {
        ;({ info } = await ensureSession(root, { args: serveArgs(o) }))
        conn = await connectSession(info.socket, { name: 'pcbjs dev', role: 'cli', project: root, token: info.token, capabilities: ['findings'] })
        watchBye(conn)
        const st = await conn.request('session/status')
        stopFollow()
        stopFollow = follow(st.log)
        console.log(`  attached to session ${info.session}, pid ${info.pid}, ${info.url}`)
        void conn.done.then(onDone)
      } catch (e: any) {
        console.error(`pcbjs: ${String(e?.message ?? e).split('\n')[0]}`)
        stopFollow()
        process.off('SIGINT', onInt)
        done(1)
      }
    }
    void conn.done.then(onDone)
  })
}

function print(info: SessionInfo, conn: SessionConn, started: boolean, joined: boolean, o: DevCommand): void {
  const r = conn.ready
  const how = started ? 'started' : joined ? 'joined, this project attached' : 'attached'
  const lines = [`\n  pcbjs dev  session ${info.session} ${how}, pid ${info.pid}`, `  Local:     ${info.url}`]
  const path = new URL(info.url).pathname
  for (const u of r.urls.filter(u => !/\/\/(localhost|127\.|\[::1\])/.test(u))) {
    const url = new URL(path, u)
    if (info.token) url.searchParams.set('token', info.token)
    lines.push(`  Network:   ${url.href}${info.edit === 'all' ? '' : ', read-only'}`)
  }
  console.log(lines.join('\n') + '\n')
  if (started) return
  const differ: string[] = []
  if (o.port !== undefined && o.port !== 0 && o.port !== r.port) differ.push(`--port ${o.port}`)
  if (o.host !== undefined && String(o.host === true ? '0.0.0.0' : o.host) !== r.host) differ.push('--host')
  if (o.edit !== undefined && o.edit !== info.edit) differ.push(`--edit ${o.edit}`)
  if (o.uiSrc) differ.push('--ui-src')
  if (differ.length) console.warn(`pcbjs: ${differ.join(', ')} applies to a new session only; session ${info.session} runs on port ${r.port}, host ${r.host}, edit ${info.edit}`)
}

/** Print what the log gains from now on; returns the stop. */
function follow(file: string): () => void {
  let at = 0
  try {
    at = statSync(file).size
  } catch {}
  const t = setInterval(() => {
    let size = 0
    try {
      size = statSync(file).size
    } catch {
      return
    }
    if (size < at) at = 0
    if (size === at) return
    const buf = Buffer.alloc(size - at)
    const fd = openSync(file, 'r')
    try {
      readSync(fd, buf, 0, buf.length, at)
    } finally {
      closeSync(fd)
    }
    at = size
    process.stdout.write(buf)
  }, 200)
  return () => clearInterval(t)
}

function openBrowser(url: string): void {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]]
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true })
      .on('error', () => {})
      .unref()
  } catch {}
}

/** The session serving `root`, else the one of its repository. */
async function sessionAt(root: string): Promise<{ socket: string; pid: number; session: string; token?: string } | null> {
  return (await liveSession(root)) ?? (await repoSession(root))
}

async function stopSession(s: { socket: string; pid: number }): Promise<void> {
  const c = await connectSession(s.socket, { name: 'pcbjs session stop', role: 'cli' })
  await c.request('session/stop').catch(() => {})
  c.close()
  for (let i = 0; i < 100 && alive(s.pid); i++) await new Promise(r => setTimeout(r, 100))
}

export async function sessionStop(dir = '.'): Promise<number> {
  const s = await sessionAt(real(dir))
  if (!s) {
    console.log(`no session serves ${real(dir)}`)
    return 0
  }
  await stopSession(s)
  console.log(alive(s.pid) ? `session ${s.session}, pid ${s.pid}, is still stopping` : `session ${s.session} stopped`)
  return 0
}

/** Exit 3 without a session. */
export async function sessionStatus(dir = '.', json = false): Promise<number> {
  const s = await sessionAt(real(dir))
  if (!s) {
    if (json) console.log('null')
    else console.log(`no session serves ${real(dir)}`)
    return 3
  }
  const c = await connectSession(s.socket, { name: 'pcbjs session status', role: 'cli', token: s.token })
  const st = await c.request('session/status')
  c.close()
  if (json) {
    console.log(JSON.stringify(st, null, 2))
    return 0
  }
  const lines = [
    `session  ${st.session}, pid ${st.pid}, pcbjs ${st.version}, since ${st.startedAt}`,
    `socket   ${st.socket}`,
    `edit     ${st.edit}${st.token ? ', LAN token in dev.json' : ''}`,
    `grace    ${st.grace} s${st.idle === null ? '' : `, idle for ${st.idle} s`}`,
    `log      ${st.log}`,
    ...st.projects.map((p: { root: string; url: string }) => `project  ${p.url}  ${p.root}`),
    ...st.clients
      .filter((x: { name: string }) => x.name !== 'pcbjs session status')
      .map((x: any) => `client   ${x.client} ${x.name}${x.role ? ` (${x.role})` : ''}, ${x.kind}, ${x.mode}`),
  ]
  console.log(lines.join('\n'))
  return 0
}
