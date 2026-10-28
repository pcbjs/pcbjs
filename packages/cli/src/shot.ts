// a headless Chrome waits for `data-ready` on <html>, see client/src/ready.ts, and captures over the DevTools protocol
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, relative, resolve } from 'node:path'
import { createServer, type ViteDevServer } from 'vite'
import { resolveConfig } from './config.js'
import { viteConfig } from './vite.js'
import { pluginState } from './plugin.js'
import { freePort } from './server.js'
import { liveSlots, errorOf } from './boards.js'
import { variantSlug } from '@pcbjs/core/variants'
import { askDev, devLine, devServerOf, realEntry, secs, type DevBoard } from './dev-reuse.js'

export type ShotView = '2d' | '3d' | 'sch'
export interface ShotOptions {
  entries?: string[]
  config?: string
  root?: string
  /** default `.pcbjs/shots` */
  outDir?: string
  /** both is 2D and 3D, the default; all adds the schematic */
  view?: ShotView | 'both' | 'all'
  /** fraction of the largest separation, 0 to 1 */
  explode?: number
  /** shown alone in 2D; several shoot one 2D view each */
  layer?: string | string[]
  /** several shoot every view once each */
  select?: string | string[]
  /** CSS pixels, default 1600 by 1000 */
  size?: [number, number]
  theme?: 'light' | 'dark'
  /** bottom flips the 2D view to the back and puts the 3D camera under the board */
  side?: 'top' | 'bottom'
  /** show Vite's own output */
  verbose?: boolean
  /** ms to wait for one view to draw, default 120 s */
  timeout?: number
  /** on 127.0.0.1; 0 or absent picks a free one */
  port?: number
  /** compile here even when a running dev server holds current boards */
  fresh?: boolean
}

export interface ShotCombo {
  select?: string
  layer?: string
}

/** Each select with each layer; --layer is 2D only, so with several layers 3D is shot once per select. */
export function shotCombos(view: ShotView, selects: string[], layers: string[]): ShotCombo[] {
  const ss = selects.length ? selects : [undefined]
  const ls = view === 'sch' || (view === '3d' && layers.length > 1) ? [undefined] : layers.length ? layers : [undefined]
  return ss.flatMap(select => ls.map(layer => ({ ...(select ? { select } : {}), ...(layer ? { layer } : {}) })))
}

export interface ShotJob {
  board: string
  target: string | null
  path: string
  view: ShotView
  file: string
  select?: string
  layer?: string
}

export const shotViews = (view?: ShotView | 'both' | 'all'): ShotView[] => (!view || view === 'both' ? ['2d', '3d'] : view === 'all' ? ['2d', '3d', 'sch'] : [view])

export const DEFAULT_SIZE: [number, number] = [1600, 1000]

/** In the order they are tried, after `$PCBJS_CHROME`. */
export function chromeCandidates(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  const out: string[] = []
  if (env.PCBJS_CHROME) out.push(env.PCBJS_CHROME)
  if (platform === 'darwin') {
    const apps = [
      'Google Chrome.app/Contents/MacOS/Google Chrome',
      'Chromium.app/Contents/MacOS/Chromium',
      'Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      'Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    ]
    for (const a of apps) out.push(`/Applications/${a}`)
    if (env.HOME) for (const a of apps) out.push(join(env.HOME, 'Applications', a))
  } else if (platform === 'win32') {
    const roots = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter((r): r is string => !!r)
    for (const r of roots) out.push(join(r, 'Google', 'Chrome', 'Application', 'chrome.exe'))
    for (const r of roots) out.push(join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))
    for (const r of roots) out.push(join(r, 'Chromium', 'Application', 'chrome.exe'))
  } else {
    const names = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'microsoft-edge-stable']
    for (const dir of (env.PATH ?? '').split(delimiter).filter(Boolean)) for (const n of names) out.push(join(dir, n))
    for (const n of names) out.push(`/usr/bin/${n}`)
    out.push('/snap/bin/chromium')
  }
  return [...new Set(out)]
}

/** `$PCBJS_CHROME`, then the usual paths; null when there is none. */
export function findChrome(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env, exists: (p: string) => boolean = existsSync): string | null {
  return chromeCandidates(platform, env).find(p => exists(p)) ?? null
}

/** See client/src/query.ts. */
export function shotQuery(view: ShotView, o: { explode?: number; layer?: string; select?: string; side?: 'top' | 'bottom'; theme?: 'light' | 'dark' }): string {
  const q = new URLSearchParams({ view })
  if (view === '3d' && o.explode !== undefined) q.set('explode', String(o.explode))
  if (o.layer) q.set('layer', o.layer)
  if (o.select) q.set('select', o.select)
  if (o.side === 'bottom' && view !== 'sch') q.set('side', 'bottom')
  if (o.theme) q.set('theme', o.theme)
  return `?${q}`
}

/** `WxH` as two positive integers; null when it does not parse. */
export function parseSize(v: string): [number, number] | null {
  const m = /^\s*(\d+)\s*[x×X,]\s*(\d+)\s*$/.exec(v)
  if (!m) return null
  const w = +m[1],
    h = +m[2]
  return w >= 100 && h >= 100 && w <= 8000 && h <= 8000 ? [w, h] : null
}

const fileSafe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'board'

/** So shots with other options never overwrite it: `-explode60`, `-select-U1`, `-F.Cu`, `-bottom`, `-dark`. */
export function shotSuffix(view: ShotView, o: { explode?: number; layer?: string; select?: string; side?: 'top' | 'bottom'; theme?: 'light' | 'dark' } = {}): string {
  return [
    view === '3d' && o.explode !== undefined ? `explode${Math.round(o.explode * 100)}` : '',
    o.select ? `select-${fileSafe(o.select)}` : '',
    o.layer && view !== 'sch' ? fileSafe(o.layer) : '',
    o.side === 'bottom' && view !== 'sch' ? 'bottom' : '',
    o.theme ?? '',
  ]
    .filter(Boolean)
    .map(p => `-${p}`)
    .join('')
}

/** Per board, per target, per view. */
export function shotJobs(
  boards: { name: string; targets: (string | null)[] }[],
  views: ShotView[],
  outDir: string,
  o: Pick<ShotOptions, 'explode' | 'layer' | 'select' | 'side' | 'theme'> = {},
): ShotJob[] {
  const out: ShotJob[] = []
  const list = (v: string | string[] | undefined) => (v === undefined ? [] : Array.isArray(v) ? v : [v])
  for (const b of boards)
    for (const t of b.targets)
      for (const view of views)
        for (const combo of shotCombos(view, list(o.select), list(o.layer))) {
          const slug = t != null ? variantSlug(t) : null
          out.push({
            board: b.name,
            target: t,
            view,
            ...combo,
            path: `/board/${encodeURIComponent(b.name)}${slug ? `/${encodeURIComponent(slug)}` : ''}`,
            file: join(
              outDir,
              `${fileSafe(b.name)}${slug ? `-${fileSafe(slug)}` : ''}-${view}${shotSuffix(view, { ...o, ...combo, select: combo.select, layer: combo.layer })}.png`,
            ),
          })
        }
  return out
}

interface Cdp {
  send(method: string, params?: object): Promise<any>
  close(): void
}

async function connect(url: string): Promise<Cdp> {
  const WS: typeof WebSocket = (globalThis as any).WebSocket ?? ((await import('ws' as string)) as any).WebSocket
  const ws = new WS(url)
  await new Promise<void>((done, fail) => {
    ws.addEventListener('open', () => done(), { once: true })
    ws.addEventListener('error', () => fail(new Error(`could not connect to Chrome at ${url}`)), { once: true })
  })
  let id = 0
  const waiting = new Map<number, { done: (v: any) => void; fail: (e: Error) => void }>()
  ws.addEventListener('message', (e: MessageEvent) => {
    const m = JSON.parse(String(e.data))
    const w = m.id !== undefined ? waiting.get(m.id) : undefined
    if (!w) return
    waiting.delete(m.id)
    if (m.error) w.fail(new Error(`${m.error.message}${m.error.data ? `: ${m.error.data}` : ''}`))
    else w.done(m.result)
  })
  ws.addEventListener('close', () => {
    for (const w of waiting.values()) w.fail(new Error('Chrome closed the connection'))
    waiting.clear()
  })
  return {
    send: (method, params = {}) =>
      new Promise((done, fail) => {
        const n = ++id
        waiting.set(n, { done, fail })
        ws.send(JSON.stringify({ id: n, method, params }))
      }),
    close: () => ws.close(),
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Resolves with the process and the page's socket URL. */
async function launch(bin: string, size: [number, number], profile: string): Promise<{ proc: ChildProcess; page: string }> {
  const args = [
    '--headless=new',
    '--hide-scrollbars',
    `--window-size=${size[0]},${size[1]}`,
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-sync',
    '--mute-audio',
    // WebGL in software when there is no GPU, as on a CI machine
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--ignore-gpu-blocklist',
    'about:blank',
  ]
  const proc = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] })
  let stderr = ''
  proc.stderr!.on('data', d => {
    stderr = (stderr + d).slice(-4000)
  })
  const exited = new Promise<never>((_, fail) =>
    proc.once('exit', code => fail(new Error(`Chrome exited with code ${code} before it was ready${stderr ? `:\n${stderr.trim().split('\n').slice(-5).join('\n')}` : ''}`))),
  )
  exited.catch(() => {})
  try {
    return { proc, page: await pageSocket(profile, exited) }
  } catch (e) {
    proc.kill()
    proc.stderr!.destroy()
    throw e
  }
}

async function pageSocket(profile: string, exited: Promise<never>): Promise<string> {
  const file = join(profile, 'DevToolsActivePort')
  const start = Date.now()
  while (!existsSync(file) || readFileSync(file, 'utf8').split('\n').length < 2) {
    if (Date.now() - start > 30000) throw new Error('Chrome did not open its debugging port within 30 s')
    await Promise.race([sleep(50), exited])
  }
  const port = readFileSync(file, 'utf8').split('\n')[0].trim()
  for (let i = 0; i < 100; i++) {
    const list = await fetch(`http://127.0.0.1:${port}/json/list`)
      .then(r => r.json() as Promise<{ type: string; webSocketDebuggerUrl: string }[]>)
      .catch(() => [])
    const page = list.find(t => t.type === 'page')
    if (page) return page.webSocketDebuggerUrl
    await Promise.race([sleep(50), exited])
  }
  throw new Error('Chrome opened no page')
}

/** Returns the error the page reported when it never draws. */
async function load(cdp: Cdp, url: string, view: ShotView, timeout: number): Promise<string | null> {
  await cdp.send('Page.navigate', { url })
  const start = Date.now()
  // the navigation replaces the document, so a ready mark seen here belongs to the new page
  await sleep(100)
  while (Date.now() - start < timeout) {
    const r = await cdp
      .send('Runtime.evaluate', {
        expression: `[document.readyState, document.documentElement.dataset.ready || '', document.querySelector('.error-box, .view3d-host .empty')?.textContent || '']`,
        returnByValue: true,
      })
      .catch(() => null)
    const [state, ready, err] = (r?.result?.value ?? ['', '', '']) as [string, string, string]
    if (state === 'complete' && ready === view) return null
    if (err.trim() && /compile error|failed/i.test(err)) return err.trim().split('\n')[0]
    await sleep(100)
  }
  return `the ${view} view did not draw within ${Math.round(timeout / 1000)} s`
}

export async function shot(opts: ShotOptions): Promise<number> {
  const bin = findChrome()
  if (!bin) {
    console.error('pcbjs: no Chrome, Chromium or Edge found; set PCBJS_CHROME to the browser binary, for example PCBJS_CHROME=/usr/bin/chromium')
    return 1
  }
  const size = opts.size ?? DEFAULT_SIZE
  const views = shotViews(opts.view)
  const timeout = opts.timeout ?? 120000
  const selects = opts.select === undefined ? [] : Array.isArray(opts.select) ? opts.select : [opts.select]
  const cfg = await resolveConfig(opts.entries ?? [], 'serve', opts.config, opts.root)
  const outDir = resolve(cfg.root, opts.outDir ?? join('.pcbjs', 'shots'))
  const state = pluginState(cfg)
  state.verbose = !!opts.verbose

  let server: ViteDevServer | null = null
  let chrome: ChildProcess | null = null
  let cdp: Cdp | null = null
  const profile = mkdtempSync(join(tmpdir(), 'pcbjs-shot-'))
  const stop = async () => {
    cdp?.close()
    cdp = null
    if (chrome && chrome.exitCode === null) {
      const p = chrome
      let timer: NodeJS.Timeout | undefined
      await new Promise<void>(done => {
        p.once('exit', () => done())
        p.kill()
        timer = setTimeout(done, 3000)
      })
      clearTimeout(timer)
    }
    // Chrome's crash handler and updater inherit its stderr and outlive it by minutes, holding the pipe and so this process open
    chrome?.stderr?.destroy()
    chrome = null
    try {
      rmSync(profile, { recursive: true, force: true })
    } catch {}
    await server?.close().catch(() => {})
    server = null
  }
  const onSignal = () => {
    void stop().finally(() => process.exit(130))
  }
  process.once('SIGINT', onSignal)
  try {
    let base = ''
    let failed = 0
    let boards: { name: string; targets: (string | null)[]; refs: string[] }[] = []
    // a running dev server with every board current serves the pages, no compile here
    const dev = opts.fresh || opts.port ? null : devServerOf(cfg.root)
    if (dev) {
      const got = await Promise.all(cfg.entries.map(e => askDev<DevBoard>(dev.origin, 'board', { entry: realEntry(e.file) })))
      if (got.every(g => g?.current && g.displayed && g.name)) {
        const route = got[0]!.route ?? '/'
        base = dev.origin + route.replace(/\/$/, '')
        boards = got.map(g => ({ name: g!.name!, targets: g!.targets ?? [null], refs: g!.refs ?? [] }))
        console.log(
          devLine(
            dev.origin,
            cfg.entries.map(e => e.rel),
            Math.max(...got.map(g => g!.ms ?? 0)),
            Math.max(...got.map(g => g!.age ?? 0)),
          ),
        )
      }
    }
    if (!base) {
      // it writes no .pcbjs/dev.json, so a dev server already running in the project keeps its own
      const host = '127.0.0.1'
      const port = opts.port ? opts.port : await freePort(host)
      const vc = viteConfig(cfg, state, 'dev')
      vc.logLevel = opts.verbose ? 'info' : 'error'
      vc.server = { ...vc.server, port, host, strictPort: true, open: false, watch: null }
      server = await createServer(vc)
      await server.listen()
      base = `http://${host}:${port}`
      // the first request waits for the first compile; the shots after it reuse that compile
      const c0 = Date.now()
      await fetch(`${base}/__pcbjs/board.json`).catch(() => null)
      console.log(`compiled  ${state.slots.map(s => s.entry.rel).join(', ')}  ${secs(Date.now() - c0)}`)
      for (const s of state.slots) {
        const e = errorOf(s)
        if (e && !s.compiled) {
          console.error(`${s.entry.rel}  compile error: ${e.split('\n')[0]}`)
          failed++
        } else if (e) {
          console.error(`${s.entry.rel}  ${s.conflict ? '' : 'compile error: '}${e.split('\n')[0]}`)
          failed++
        }
      }
      boards = liveSlots(state.slots)
        .filter(s => !s.error)
        .map(s => ({ name: s.compiled![0].board.name, targets: s.compiled!.map(c => c.board.variant?.name ?? null), refs: s.compiled![0].board.footprints.map(f => f.ref) }))
    }
    for (const sel of selects) for (const b of boards) if (!b.refs.includes(sel)) console.error(`warning  --select ${sel} matches no part of ${b.name}`)
    const jobs = shotJobs(boards, views, outDir, opts)
    if (!jobs.length) return 1

    const launched = await launch(bin, size, profile)
    chrome = launched.proc
    cdp = await connect(launched.page)
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: size[0], height: size[1], deviceScaleFactor: 1, mobile: false })
    mkdirSync(outDir, { recursive: true })
    for (const j of jobs) {
      const t0 = Date.now()
      const label = [`${j.board}${j.target ? ` [${j.target}]` : ''}`, j.view, j.select ? `select ${j.select}` : '', j.layer ?? ''].filter(Boolean).join('  ')
      const err = await load(cdp, base + j.path + shotQuery(j.view, { ...opts, select: j.select, layer: j.layer }), j.view, timeout)
      if (err) {
        console.error(`${label}  FAIL  ${err}`)
        failed++
        continue
      }
      const png = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
      writeFileSync(j.file, Buffer.from(png.data, 'base64'))
      const rel = relative(process.cwd(), j.file)
      console.log(`${rel && !rel.startsWith('..') ? rel : j.file}  ${label}  ${size[0]}x${size[1]}  ${secs(Date.now() - t0)}`)
    }
    return failed ? 1 : 0
  } finally {
    process.off('SIGINT', onSignal)
    await stop()
  }
}
