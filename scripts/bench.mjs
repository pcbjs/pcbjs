#!/usr/bin/env node
// Times `pcbjs check` in every example project, cold after deleting its route cache, compile cache and typecheck cache, then warm,
// and the latency of typing: ms from a keystroke in Blinky's text block to its first facet, through a session, an editor and a viewer;
// and the preview's frame budgets on usb3-hub in a headless Chromium, `view`, see packages/pcbjs/tests/view-perf.mjs.
// Budgets live in bench.json with `where`, local or ci, the place they were measured; a run compares only against budgets from its own place, CI when the CI variable is set.
// A run elsewhere shows the budgets scaled by `ciScale`, the stated laptop to CI factor, and passes; the bench job uploads its numbers so they can be committed as CI budgets.
// The view budgets are the plan's, fixed; --write records the view's last measurement beside them.
// Usage: node scripts/bench.mjs [--write] [--runs <n>] [--out <file>] [project dir under examples/ ... | keystroke | view]; --write records the medians as the budgets, --out saves them elsewhere
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import WebSocket from 'ws'

const root = join(import.meta.dirname, '..')
const bin = join(root, 'packages/pcbjs/bin/pcbjs.js')
const examples = join(root, 'examples')
const budgetFile = join(root, 'bench.json')
const OVER = 1.2
// seconds a time may exceed its budget by in any case, the noise of a one second check
const SLACK = 0.5
// ms a latency may exceed its budget by in any case
const SLACK_MS = 30
const KEYSTROKE = 'keystroke-to-first-facet'

const argv = process.argv.slice(2)
const option = name => {
  const i = argv.indexOf(name)
  return i < 0 ? undefined : argv.splice(i, 2)[1]
}
const write = argv.includes('--write')
const out = option('--out')
const runs = Number(option('--runs') ?? (write ? 3 : 1))
const named = argv.filter(a => a !== '--write')
const names = named.filter(a => a !== 'keystroke' && a !== 'view')
const typing = !named.length || named.includes('keystroke')
const viewing = !named.length || named.includes('view')
const where = process.env.CI ? 'ci' : 'local'

function projects(dir) {
  if (readdirSync(dir).some(f => /^pcb\.config\.(ts|mts|js|mjs)$/.test(f))) return [dir]
  return readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
    .flatMap(e => projects(join(dir, e.name)))
}

// seconds of one check; its findings are check-examples' job, so the exit code is not judged
function check(dir) {
  const start = performance.now()
  const r = spawnSync(process.execPath, [bin, 'check'], { cwd: dir, encoding: 'utf8', maxBuffer: 64 << 20 })
  if (r.error || r.signal) throw new Error(`${relative(examples, dir)}: ${r.error?.message ?? r.signal}`)
  return (performance.now() - start) / 1000
}

function coldWarm(dir) {
  for (const p of ['routes', 'cache', 'typecheck.json']) rmSync(join(dir, '.pcbjs', p), { recursive: true, force: true })
  return { cold: check(dir), warm: check(dir) }
}

const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const round = s => Math.round(s * 100) / 100
const cell = (s, w = 8) => (s === undefined ? '' : s.toFixed(1)).padStart(w)

const saved = existsSync(budgetFile) ? JSON.parse(readFileSync(budgetFile, 'utf8')) : null
const compare = !write && saved?.where === where
const ciScale = saved?.ciScale ?? 1
const scale = compare ? 1 : where === 'ci' ? ciScale : 1 / ciScale
const dirs = names.length ? names.map(n => join(examples, n)) : named.length ? [] : projects(examples)

const until = async (fn, ms = 60000) => {
  for (const end = Date.now() + ms; !fn(); await new Promise(r => setTimeout(r, 10))) if (Date.now() > end) throw new Error('the keystroke bench timed out')
}
const socket = async (...a) => {
  const ws = new WebSocket(...a)
  await new Promise((ok, fail) => (ws.once('open', ok), ws.once('error', fail)))
  return ws
}

/** Median ms from a keystroke in Blinky's text block to the first facet the viewer gets after it: keys 400 ms apart, each after the full compile of the one before. */
async function keystroke(keys = 7) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'pcbjs-bench-keys-')))
  cpSync(join(examples, 'demo'), dir, { recursive: true, filter: f => !f.includes('/.pcbjs') && !f.includes('/node_modules') })
  mkdirSync(join(dir, 'node_modules'))
  symlinkSync(join(root, 'node_modules', '@pcbjs'), join(dir, 'node_modules', '@pcbjs'), 'dir')
  const cfg = join(dir, 'pcb.config.ts')
  writeFileSync(cfg, readFileSync(cfg, 'utf8').replace(/entries:\s*\[[^\]]*\]/, "entries: ['blinky.pcb.tsx']"))
  const child = spawn(process.execPath, [bin, 'session', 'serve', '--port', '0', '--host', '127.0.0.1'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  child.stdout.on('data', d => (log += d))
  child.stderr.on('data', d => (log += d))
  try {
    await until(() => /\[pcbjs\] session \w+, pid/.test(log))
    const port = new URL(JSON.parse(readFileSync(join(dir, '.pcbjs', 'dev.json'), 'utf8')).url).port
    // a 2D page: a viewer of the session observing Blinky
    const view = await socket(`ws://127.0.0.1:${port}/__pcbjs/session`)
    const facets = []
    view.on('message', raw => {
      const m = JSON.parse(String(raw))
      if (m.event === 'pcbjs:facet' && m.data.partial) facets.push(performance.now())
    })
    view.send(JSON.stringify({ event: 'pcbjs:ide:hello', data: { name: 'bench viewer', version: '0', protocol: 5, major: 1, capabilities: [], role: 'viewer' } }))
    view.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'session/observe', params: { board: 'Blinky', target: null, facets: ['meta', 'layers'] } }))
    const ed = await socket(`ws://127.0.0.1:${port}/__pcbjs/session`)
    const frames = []
    ed.on('message', raw => frames.push(JSON.parse(String(raw))))
    const send = m => ed.send(JSON.stringify(m))
    const file = join(dir, 'blinky.pcb.tsx')
    const uri = pathToFileURL(file).href
    let text = readFileSync(file, 'utf8')
    send({ event: 'pcbjs:ide:hello', data: { name: 'bench', version: '0', protocol: 2, major: 1, capabilities: [], role: 'editor', project: dir } })
    await until(() => frames.some(m => m.event === 'pcbjs:ide:ready'))
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { processId: null, rootUri: pathToFileURL(dir).href, capabilities: {} } })
    await until(() => frames.some(m => m.id === 1))
    send({ jsonrpc: '2.0', method: 'initialized', params: {} })
    send({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: { textDocument: { uri, languageId: 'typescriptreact', version: 1, text } } })
    send({ jsonrpc: '2.0', id: 2, method: 'session/check', params: {} })
    await until(() => frames.some(m => m.id === 2))
    const ms = []
    for (let i = 1; i <= keys; i++) {
      text = text.replace(/Blinky · pcbjsx*/, `Blinky · pcbjs${'x'.repeat(i)}`)
      const n = facets.length
      const at = performance.now()
      send({ jsonrpc: '2.0', method: 'textDocument/didChange', params: { textDocument: { uri, version: i + 1 }, contentChanges: [{ text }] } })
      await until(() => facets.length > n, 10000)
      ms.push(facets[n] - at)
      await new Promise(r => setTimeout(r, 400))
    }
    view.close()
    ed.close()
    return Math.round(median(ms))
  } finally {
    child.kill('SIGKILL')
    rmSync(dir, { recursive: true, force: true })
  }
}

const measured = {}
const slow = []
console.log(`${'example'.padEnd(24)}${cell(undefined)}cold  budget${cell(undefined)}warm  budget`)
for (const dir of dirs) {
  const name = relative(examples, dir).split('\\').join('/')
  const times = Array.from({ length: runs }, () => coldWarm(dir))
  const t = { cold: round(median(times.map(x => x.cold))), warm: round(median(times.map(x => x.warm))) }
  measured[name] = t
  const b = saved?.budgets?.[name]
  const budget = k => (b ? b[k] * scale : undefined)
  console.log(`${name.padEnd(24)}${cell(t.cold, 12)}${cell(budget('cold'))}${cell(t.warm, 12)}${cell(budget('warm'))}`)
  if (compare && b) for (const k of ['cold', 'warm']) if (t[k] > Math.max(b[k] * OVER, b[k] + SLACK)) slow.push(`${name} ${k} ${t[k].toFixed(1)} s, budget ${b[k].toFixed(1)} s`)
}

const latency = {}
if (typing) {
  const all = []
  for (let i = 0; i < runs; i++) all.push(await keystroke())
  const ms = median(all)
  latency[KEYSTROKE] = ms
  const b = saved?.latency?.[KEYSTROKE]
  console.log(`${KEYSTROKE.padEnd(24)}${String(ms).padStart(9)} ms${b === undefined ? '' : `  budget ${Math.round(b * scale)} ms`}`)
  if (compare && b !== undefined && ms > Math.max(b * OVER, b + SLACK_MS)) slow.push(`${KEYSTROKE} ${ms} ms, budget ${b} ms`)
}

let view = saved?.view
if (viewing) {
  const { overBudget, viewBench, viewSkip } = await import('../packages/pcbjs/tests/view-perf.mjs')
  const why = viewSkip()
  if (why) console.log(`view  skipped: ${why}`)
  else {
    const { out: v } = await viewBench()
    const budgets = view?.budgets ?? {}
    for (const [k, b] of Object.entries(budgets))
      console.log(
        `${('view ' + k).padEnd(24)}${String(Math.round(v[k] * 10) / 10).padStart(9)} ${/^(hover|dragFirst)/.test(k) ? 'frames' : /^calls/.test(k) ? 'draws' : 'ms'}  budget ${b}`,
      )
    console.log(`${'view findings'.padEnd(24)}${String(v.findingCount).padStart(9)}`)
    for (const o of overBudget(v, budgets)) slow.push(`view ${o}`)
    view = { ...view, measured: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, Math.round(x * 10) / 10])) }
  }
}

const record = {
  where,
  measured: `${new Date().toISOString().slice(0, 10)}, ${process.platform} ${process.arch}, Node ${process.versions.node}, median of ${runs}`,
  ciScale,
  budgets: { ...saved?.budgets, ...measured },
  latency: { ...saved?.latency, ...latency },
  ...(view ? { view } : {}),
}
if (write || out) {
  const file = out ? resolve(out) : budgetFile
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(record, null, 2) + '\n')
  console.log(`wrote ${out ?? 'bench.json'}`)
}
if (!write && !compare) console.log(`budgets measured ${saved ? `on ${saved.where}` : 'nowhere'}, this run on ${where}: shown times ${scale}, not compared`)
for (const s of slow) console.log(`SLOW  ${s}, over by more than ${Math.round((OVER - 1) * 100)} percent and ${SLACK} s or ${SLACK_MS} ms`)
process.exit(slow.length ? 1 : 0)
