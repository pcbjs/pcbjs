#!/usr/bin/env node
// Compiles the demo boards and highspeed in a headless Chromium through @pcbjs/compile/browser and in Node through the CLI, warm or cold alike since stage-equality keeps them equal, and compares each target's board JSON, the router's own counts aside, finding ids and inspect --lengths byte for byte, the project root written as /project.
// Usage: node scripts/browser-equality.mjs [--port <http>] [--devtools <port>] [--dump <dir>] [project under examples/ ...]; --dump writes both sides of what differs; without a Chromium, found by PCBJS_CHROME or the usual paths, it prints a notice and exits 0.
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { delimiter, dirname, extname, join, relative, resolve, sep } from 'node:path'

const repo = join(import.meta.dirname, '..')
const examples = join(repo, 'examples')
const dist = (pkg, f) => join(repo, 'packages', pkg, 'dist', f)
const ROOT = '/project'
const sha1 = s => createHash('sha1').update(s).digest('hex')

/** `$PCBJS_CHROME`, then the usual places of Chrome, Chromium and Edge. */
export function chromeCandidates(platform = process.platform, env = process.env) {
  const out = env.PCBJS_CHROME ? [env.PCBJS_CHROME] : []
  if (platform === 'darwin') {
    const apps = ['Google Chrome.app/Contents/MacOS/Google Chrome', 'Chromium.app/Contents/MacOS/Chromium', 'Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
    for (const a of apps) out.push(`/Applications/${a}`, ...(env.HOME ? [join(env.HOME, 'Applications', a)] : []))
  } else if (platform === 'win32') {
    const roots = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean)
    for (const r of roots) out.push(join(r, 'Google/Chrome/Application/chrome.exe'), join(r, 'Microsoft/Edge/Application/msedge.exe'), join(r, 'Chromium/Application/chrome.exe'))
  } else {
    const names = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge']
    for (const d of (env.PATH ?? '').split(delimiter).filter(Boolean)) for (const n of names) out.push(join(d, n))
    out.push('/snap/bin/chromium')
  }
  out.push(...playwright(platform, env))
  return [...new Set(out)]
}

/** The Chromium builds Playwright downloaded, newest first. */
function playwright(platform, env) {
  const home = env.HOME ?? env.USERPROFILE ?? ''
  const root =
    platform === 'darwin' ? join(home, 'Library/Caches/ms-playwright') : platform === 'win32' ? join(env.LOCALAPPDATA ?? '', 'ms-playwright') : join(home, '.cache/ms-playwright')
  const shell = {
    darwin: 'chrome-headless-shell-mac-arm64/chrome-headless-shell',
    win32: 'chrome-headless-shell-win64/chrome-headless-shell.exe',
    linux: 'chrome-headless-shell-linux64/chrome-headless-shell',
  }[platform]
  const dirs = existsSync(root) ? readdirSync(root).filter(d => d.startsWith('chromium_headless_shell-')) : []
  return shell
    ? dirs
        .sort()
        .reverse()
        .map(d => join(root, d, shell))
    : []
}

/** Every candidate that exists, in order. */
export const chromes = () => chromeCandidates().filter(p => existsSync(p))

/** The CLI's compile of a project, one line of JSON per target. It runs from a folder named node_modules, as the CLI's own frames are skipped, so no route takes this script as its caller. */
const CHILD = `
const [dir, cli] = process.argv.slice(2)
process.chdir(dir)
const { resolveConfig } = await import(cli + '/project/config.js')
const { pluginState } = await import(cli + '/server/site.js')
const { compileServer, compileSlots } = await import(cli + '/project/compile.js')
const { viteLoader } = await import(cli + '/project/loader.js')
const { inspectBoard } = await import(cli + '/project/inspect.js')
const cfg = await resolveConfig([], 'build', undefined, dir, () => {})
const state = pluginState(cfg)
const server = await compileServer(cfg)
for (const s of state.slots) {
  const t0 = performance.now()
  await compileSlots(viteLoader(server), cfg, [s], new Map())
  const ms = Math.round(performance.now() - t0)
  if (!s.compiled) throw new Error(s.entry.rel + ': ' + s.error)
  for (const c of s.compiled) {
    const b = c.board
    const lengths = inspectBoard(b, c.entry.rel, cfg.root, undefined, { lengths: true }).text.join('\\n')
    process.stdout.write(JSON.stringify({ entry: c.entry.rel, name: b.name, target: b.variant?.name ?? null, ms, board: JSON.stringify(b), lengths }) + '\\n')
  }
}
await server.close()
`

function nodeCompile(dir, tmp) {
  const child = join(tmp, 'node_modules', 'equality', 'child.mjs')
  mkdirSync(dirname(child), { recursive: true })
  writeFileSync(child, CHILD)
  const env = { ...process.env, SOURCE_DATE_EPOCH: '1767225600', NODE_ENV: 'production' }
  const r = spawnSync(process.execPath, [child, dir, join(repo, 'packages/cli/dist')], { env, encoding: 'utf8', maxBuffer: 256 << 20 })
  if (r.status !== 0) throw new Error(`the Node compile of ${relative(examples, dir)} failed:\n${r.stderr.trim().split('\n').slice(-6).join('\n')}`)
  return r.stdout
    .trim()
    .split('\n')
    .map(l => JSON.parse(l))
}

/** Esbuild as the bundler: it keeps every function's name, which a design's parts are named by, where Rollup renames shadowing ones. */
const bundle = (esbuild, o) =>
  esbuild.build({
    bundle: true,
    format: 'esm',
    platform: 'browser',
    splitting: true,
    keepNames: true,
    sourcemap: 'linked',
    metafile: true,
    target: 'esnext',
    logLevel: 'warning',
    define: { 'process.env.NODE_ENV': '"production"' },
    jsx: 'automatic',
    jsxImportSource: '@pcbjs/core',
    ...o,
  })

/** Each entry of a project and its config as browser ESM, as the `?pcb:module` facet builds them, written under `out`. */
export async function buildProject(dir, out) {
  const { resolveConfig } = await import(dist('cli', 'project/config.js'))
  const { buildModules } = await import(dist('cli', 'project/module-build.js'))
  const cfg = await resolveConfig([], 'build', undefined, dir, () => {})
  const built = await buildModules(cfg, { outdir: out })
  for (const [rel, bytes] of built.outputs) {
    mkdirSync(dirname(join(out, rel)), { recursive: true })
    writeFileSync(join(out, rel), bytes)
  }
  return { cfg, built }
}

/** The worker and the page that drives it, as browser ESM. */
async function buildRuntime(esbuild, out) {
  mkdirSync(out, { recursive: true })
  writeFileSync(
    join(out, 'page.mjs'),
    `import { compileInBrowser } from ${JSON.stringify(dist('compile', 'browser.js'))}\nconst worker = () => new Worker('/rt/worker/browser-worker.js', { type: 'module' })\nwindow.compileBoard = module => compileInBrowser(module, { worker, boards: true }).then(r => ({ ...r, facets: r.facets.map(f => [f.board, f.target ?? '', f.facet, f.stage, f.hash]) }))\n`,
  )
  await bundle(esbuild, { absWorkingDir: repo, entryPoints: [dist('export', 'browser-worker.js')], outdir: join(out, 'worker') })
  await bundle(esbuild, { absWorkingDir: repo, entryPoints: [join(out, 'page.mjs')], outdir: join(out, 'page') })
  writeFileSync(join(out, 'index.html'), '<!doctype html><meta charset="utf-8"><script type="module" src="/rt/page/page.js"></script>')
}

const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.map': 'application/json', '.json': 'application/json', '.html': 'text/html' }

/** /rt/ the runtime, /p/<project>/ each project's modules, /f/<project>/ its files. */
function serve(tmp, port) {
  const server = createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    const [, kind, ...rest] = url.split('/')
    const file =
      url === '/'
        ? join(tmp, 'rt', 'index.html')
        : kind === 'rt'
          ? join(tmp, 'rt', ...rest)
          : kind === 'p'
            ? join(tmp, 'p', ...rest)
            : kind === 'f'
              ? join(examples, ...rest)
              : null
    if (!file || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end()
      return
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file))
  })
  return new Promise(done => server.listen(port, '127.0.0.1', () => done(server)))
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

/** Stop an owned, detached browser process group, including surviving children. */
export async function stopChrome(proc) {
  if (!proc?.pid) return
  const signal = name => {
    try {
      if (process.platform === 'win32') proc.kill(name)
      else process.kill(-proc.pid, name)
    } catch (error) {
      if (error.code !== 'ESRCH') throw error
    }
  }
  const exited = proc.exitCode !== null || proc.signalCode !== null ? Promise.resolve() : new Promise(resolve => proc.once('exit', resolve))
  const timer = setTimeout(() => signal('SIGKILL'), 3000)
  try {
    signal('SIGTERM')
    await exited
    if (process.platform !== 'win32') {
      const groups = spawnSync('ps', ['-axo', 'pgid=,stat='], { encoding: 'utf8' })
      const alive = groups.stdout?.split('\n').some(line => {
        const [group, state] = line.trim().split(/\s+/)
        return Number(group) === proc.pid && !state?.startsWith('Z')
      })
      if (groups.status === 0 && !alive) return
    }
    signal('SIGKILL')
  } finally {
    clearTimeout(timer)
  }
}

/** A headless Chromium on about:blank and the DevTools socket of its page. */
async function launch(bin, profile, port) {
  const proc = spawn(
    bin,
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-networking',
      'about:blank',
    ],
    {
      stdio: 'ignore',
      detached: process.platform !== 'win32',
    },
  )
  try {
    const file = join(profile, 'DevToolsActivePort')
    for (let i = 0; !(existsSync(file) && readFileSync(file, 'utf8').split('\n').length >= 2); i++) {
      if (proc.exitCode !== null || i > 600) {
        throw new Error(proc.exitCode !== null ? `exited with code ${proc.exitCode}` : 'no DevTools port within 30 s')
      }
      await sleep(50)
    }
    const dt = readFileSync(file, 'utf8').split('\n')[0].trim()
    for (let i = 0; i < 100; i++) {
      const list = await fetch(`http://127.0.0.1:${dt}/json/list`)
        .then(r => r.json())
        .catch(() => [])
      const page = list.find(t => t.type === 'page')
      if (page) return { proc, socket: page.webSocketDebuggerUrl }
      await sleep(50)
    }
    throw new Error('Chromium opened no page')
  } catch (error) {
    await stopChrome(proc)
    throw error
  }
}

/** The first candidate that opens a page; a browser that exits at once, as an installed Chrome may, gives way to the next. */
export async function launchAny(bins, tmp, port) {
  const errors = []
  for (const [i, bin] of bins.entries()) {
    try {
      return { bin, ...(await launch(bin, join(tmp, `profile-${i}`), port)) }
    } catch (e) {
      errors.push(`${bin}: ${e.message}`)
    }
  }
  throw new Error(`no Chromium started:\n${errors.join('\n')}`)
}

export async function cdp(url) {
  const ws = new WebSocket(url)
  await new Promise((done, fail) => {
    ws.addEventListener('open', done, { once: true })
    ws.addEventListener('error', () => fail(new Error(`no DevTools socket at ${url}`)), { once: true })
  })
  let id = 0
  const waiting = new Map()
  const logs = []
  const handlers = new Map()
  ws.addEventListener('message', e => {
    const m = JSON.parse(String(e.data))
    if (m.method) for (const fn of handlers.get(m.method) ?? []) fn(m.params)
    if (m.method === 'Runtime.consoleAPICalled') logs.push(`${m.params.type}: ${m.params.args.map(a => a.value ?? a.description).join(' ')}`)
    const w = waiting.get(m.id)
    if (!w) return
    waiting.delete(m.id)
    m.error ? w.fail(new Error(m.error.message)) : w.done(m.result)
  })
  const send = (method, params = {}) =>
    new Promise((done, fail) => {
      waiting.set(++id, { done, fail })
      ws.send(JSON.stringify({ id, method, params }))
    })
  // `on` hears an event of the page, such as Network.responseReceived
  const on = (method, fn) => handlers.set(method, [...(handlers.get(method) ?? []), fn])
  return { send, on, logs, close: () => ws.close() }
}

export async function evaluate(page, expression) {
  const r = await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
  return r.result.value
}

/** The module of one entry: its built modules under /p/<project>/, every project file under /f/<project>/. */
export async function moduleOf(project, { built }, entry) {
  const { browserModule } = await import(dist('cli', 'project/module-build.js'))
  return browserModule(built, entry, { output: rel => `/p/${project}/${rel}`, file: rel => `/f/${project}/${rel}` })
}

/** A board's JSON without the router's own counts, which tell a warm compile from a cold one, as stage-equality.mjs leaves them out. */
function canonical(json) {
  const b = JSON.parse(json)
  return JSON.stringify({ ...b, routing: b.routing && { ...b.routing, cached: undefined, ripped: undefined, rounds: undefined } })
}

/** The first place two texts differ, with a little of each around it. */
function firstDiff(a, b) {
  let i = 0
  while (i < a.length && a[i] === b[i]) i++
  return `at ${i}: node …${a.slice(Math.max(0, i - 80), i + 80)}… browser …${b.slice(Math.max(0, i - 80), i + 80)}…`
}

async function main(argv) {
  const flag = name => {
    const i = argv.indexOf(name)
    return i < 0 ? null : argv.splice(i, 2)[1]
  }
  const port = Number(flag('--port') ?? 0)
  const devtools = Number(flag('--devtools') ?? 0)
  const dump = flag('--dump')
  const projects = argv.length ? argv : ['demo', 'highspeed']
  const bins = chromes()
  if (!bins.length) {
    console.log('browser-equality: skipped, no Chromium found; set PCBJS_CHROME to one')
    return 0
  }
  const esbuild = await import('esbuild')
  const tmp = mkdtempSync(join(tmpdir(), 'pcbjs-browser-eq-'))
  const { inspectBoard } = await import(dist('cli', 'project/inspect.js'))
  const { boardFindings } = await import(dist('export', 'findings.js'))
  let server, chrome, page
  let bad = 0
  try {
    const t0 = performance.now()
    await buildRuntime(esbuild, join(tmp, 'rt'))
    const built = {}
    for (const p of projects) built[p] = await buildProject(join(examples, p), join(tmp, 'p', p))
    console.log(`built the worker and ${projects.length} projects in ${Math.round(performance.now() - t0)} ms`)
    server = await serve(tmp, port)
    const at = `http://127.0.0.1:${server.address().port}/`
    chrome = await launchAny(bins, tmp, devtools)
    console.log(`Chromium: ${chrome.bin}`)
    page = await cdp(chrome.socket)
    await page.send('Runtime.enable')
    await page.send('Page.navigate', { url: at })
    for (let i = 0; i < 200 && !(await evaluate(page, 'typeof window.compileBoard === "function"').catch(() => false)); i++) await sleep(50)
    for (const p of projects) {
      const dir = join(examples, p)
      const node = nodeCompile(dir, tmp)
      const norm = s => s.split(dir).join(ROOT)
      for (const entry of built[p].cfg.entries) {
        const module = await moduleOf(p, built[p], entry)
        const r = await evaluate(page, `compileBoard(${JSON.stringify(module)})`)
        if (!r.check.ok) {
          bad++
          console.log(`DIFF  self-check ${r.check.hash}, Node ${r.check.want}`)
        }
        const mine = node.filter(n => n.entry === entry.rel)
        for (const n of mine) {
          const got = r.boards.find(b => b.board === n.name && (b.target ?? null) === n.target)
          const name = `${p} ${entry.rel}${n.target ? ` [${n.target}]` : ''}`
          if (!got) {
            bad++
            console.log(`DIFF  ${name}: no board from the browser`)
            continue
          }
          const nb = norm(n.board)
          const bb = JSON.parse(got.json)
          const ids = b => JSON.stringify(boardFindings(b, ROOT).map(f => f.id))
          const checks = {
            board: [canonical(nb), canonical(got.json)],
            ids: [ids(JSON.parse(nb)), ids(bb)],
            lengths: [norm(n.lengths), inspectBoard(bb, entry.rel, ROOT, undefined, { lengths: true }).text.join('\n')],
          }
          const diff = Object.entries(checks).filter(([, [a, b]]) => a !== b)
          bad += diff.length ? 1 : 0
          console.log(`${diff.length ? 'DIFF' : 'ok  '}  ${name}: node ${n.ms} ms, browser ${r.ms} ms${diff.length ? '' : `, board ${sha1(nb).slice(0, 12)}`}`)
          for (const [k, [a, b]] of diff) console.log(`      ${k} ${firstDiff(a, b)}`)
          if (dump && diff.length) {
            mkdirSync(dump, { recursive: true })
            const base = join(dump, `${p}-${n.name}${n.target ? `-${n.target}` : ''}`.replace(/[^\w.-]+/g, '_'))
            for (const [k, [a, b]] of diff) (writeFileSync(`${base}.${k}.node.json`, a), writeFileSync(`${base}.${k}.browser.json`, b))
          }
        }
        if (r.mismatch) console.log(`      mismatch ${r.mismatch.join(', ')}`)
      }
    }
    if (page.logs.length) console.log(page.logs.map(l => `      console ${l}`).join('\n'))
  } finally {
    page?.close()
    await stopChrome(chrome?.proc)
    server?.close()
    // Chromium may still be writing its profile as it exits
    rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
  console.log(bad ? `${bad} targets differ between the browser and Node` : 'every target agrees between the browser and Node')
  return bad ? 1 : 0
}

if (import.meta.filename === resolve(process.argv[1] ?? '')) process.exit(await main(process.argv.slice(2)))
