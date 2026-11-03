// `pcbjs script`, `script --watch` and `pcbjs repl`: code against the board API, in the session when one is live, else on a compile here.
import { realpathSync } from 'node:fs'
import { start, type REPLServer } from 'node:repl'
import { resolveConfig, type ResolvedConfig } from './project/config.js'
import { compileHere, type Local } from './project/local.js'
import { pickBoards } from './project/query.js'
import type { ScriptResult } from '@pcbjs/core/protocol'
import { bind, runScript, scriptContext } from './project/sandbox.js'
import { connect, sessionLine, sessionOf } from './session/thin.js'
import type { Envelope } from '@pcbjs/core/protocol'
import type { SessionInfo } from './session/frames.js'

export interface ScriptOptions {
  code?: string
  board?: string
  target?: string
  /** ms the code may run */
  timeout?: number
  watch?: string
  scope?: string[]
  config?: string
  fresh?: boolean | 'all'
  verbose?: boolean
}

const readStdin = async (): Promise<string> => {
  let s = ''
  for await (const chunk of process.stdin) s += chunk
  return s
}

/** Prints the output or the error; the exit code. */
function report(r: ScriptResult): number {
  if (r.exit === 0) {
    if (r.output !== null) console.log(r.output)
    return 0
  }
  console.error(`pcbjs: ${r.error}`)
  return r.exit
}

function globalsOf(here: Local, o: Pick<ScriptOptions, 'board' | 'target'>) {
  const picked = pickBoards(here.boards, { target: o.target })
  const board = o.board ? picked.find(b => b.name === o.board) : picked[0]
  if (o.board && !board) throw new Error(`no board ${o.board}; boards: ${picked.map(b => b.name).join(', ')}`)
  return { board: board?.api ?? null, boards: picked.map(b => b.api), snapshot: here.snapshot }
}

async function project(o: ScriptOptions): Promise<{ cfg: ResolvedConfig; root: string; info: SessionInfo | null }> {
  const cfg = await resolveConfig([], 'build', o.config, undefined, () => {})
  const root = realpathSync(cfg.root)
  return { cfg, root, info: o.fresh ? null : await sessionOf(root) }
}

export async function script(o: ScriptOptions): Promise<number> {
  if (o.watch !== undefined) return watch(o)
  const code = o.code === '-' ? await readStdin() : (o.code ?? '')
  const { cfg, root, info } = await project(o)
  if (info) {
    const c = await connect(info, 'pcbjs script', root)
    try {
      const e = await c.request('session/script', { project: root, code, board: o.board, target: o.target, timeout: o.timeout }, 600_000)
      console.error(sessionLine(info, e))
      return report(e.value)
    } finally {
      c.close()
    }
  }
  const here = await compileHere(cfg, { verbose: o.verbose, fresh: o.fresh })
  for (const l of here.errors) console.error(l)
  return report(runScript(code, scriptContext(globalsOf(here, o)), o.timeout))
}

/** The expression against each new snapshot, printed when its value changed; `--scope` evaluates only after events that touch the scope. */
async function watch(o: ScriptOptions): Promise<number> {
  const { root, info } = await project(o)
  if (!info) {
    console.error(`pcbjs: script --watch follows a session, and none serves ${root}; start one with pcbjs dev`)
    return 3
  }
  const c = await connect(info, 'pcbjs script --watch', root)
  let last: string | null = null
  let busy: Promise<void> = Promise.resolve()
  let ended = false
  const evaluate = () =>
    (busy = busy.then(async () => {
      if (ended) return
      const e = await c.request('session/script', { project: root, code: o.watch!, board: o.board, target: o.target, timeout: o.timeout }, 600_000)
      const r = e.value
      const text = r.exit === 0 ? (r.output ?? '') : `error: ${r.error}`
      if (text === last) return
      last = text
      console.log(text)
    }))
  await evaluate()
  // a findings event marks a finished compile; with a scope only those touching it count
  let seen = ''
  c.onEvent((event, data: any) => {
    if (event !== 'session/event' || data?.kind !== 'findings' || data.data?.snapshot === seen) return
    seen = data.data.snapshot
    void evaluate()
  })
  await c.request('session/events', { project: root, follow: true, kind: ['findings'], ...(o.scope?.length ? { scope: o.scope } : {}) })
  return new Promise<number>(done => {
    const stop = () => {
      ended = true
      c.close()
      done(0)
    }
    process.once('SIGINT', stop)
    void c.done.then(() => {
      ended = true
      done(0)
    })
  })
}

/** `node:repl` whose lines run as scripts; in a session the context persists per connection and `board` follows the newest snapshot. */
export async function repl(o: ScriptOptions): Promise<number> {
  const { cfg, root, info } = await project(o)
  let server: REPLServer
  if (info) {
    const c = await connect(info, 'pcbjs repl', root)
    console.log(`session ${info.session}, ${root}; board follows the newest snapshot, .exit leaves`)
    server = start({
      prompt: 'pcbjs> ',
      ignoreUndefined: true,
      writer: (v: unknown) => String(v),
      eval: (code, _ctx, _file, cb) => {
        c.request('session/script', { project: root, code, board: o.board, target: o.target, timeout: o.timeout, context: 'repl' }, 600_000).then(
          e => {
            if (e.value.moved) console.log(`board now at snapshot ${e.snapshot}`)
            cb(null, e.value.exit === 0 ? (e.value.output ?? undefined) : `error: ${e.value.error}`)
          },
          err => cb(err, undefined),
        )
      },
    })
    server.defineCommand('refresh', {
      help: 'the session rebinds board to the newest snapshot before each line',
      action() {
        console.log('the session rebinds board to the newest snapshot before each line')
        this.displayPrompt()
      },
    })
    server.on('exit', () => c.close())
  } else {
    let here = await compileHere(cfg, { verbose: o.verbose, fresh: o.fresh })
    for (const l of here.errors) console.error(l)
    const ctx = scriptContext(globalsOf(here, o))
    console.log(`compiled here as snapshot ${here.snapshot}; .refresh compiles again, .exit leaves`)
    server = start({
      prompt: 'pcbjs> ',
      ignoreUndefined: true,
      writer: (v: unknown) => String(v),
      eval: (code, _ctx, _file, cb) => {
        const r = runScript(code, ctx, o.timeout)
        cb(null, r.exit === 0 ? (r.output ?? undefined) : `error: ${r.error}`)
      },
    })
    server.defineCommand('refresh', {
      help: 'compile the boards again and rebind board',
      async action() {
        here = await compileHere(cfg, { verbose: o.verbose })
        bind(ctx, globalsOf(here, o))
        console.log(`board now at snapshot ${here.snapshot}`)
        this.displayPrompt()
      },
    })
  }
  return new Promise(done => server.on('exit', () => done(0)))
}
