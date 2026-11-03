#!/usr/bin/env node
// Compiles every example and target five times in fresh processes, cold, cancelled at every stage boundary and resumed, warm, with the stage objects deleted and with one corrupted; prints per board a hash of its JSON, findings, inspect --lengths, SVGs, GLB and fab set at a fixed date. The runs must agree on all but the router's own counts, the warm one hitting every stage.
// Usage: node scripts/stage-equality.mjs [--save <file>] [--against <file>] [project dir under examples/ ...]; --against compares the cold and warm lines, any differing hash or disagreeing run exits 1. A route's source names this file's compileSlots line, so keep it where it is.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = join(import.meta.dirname, '..')
const examples = join(root, 'examples')
const cli = p => join(root, 'packages/cli/dist', p)
const sha = s => createHash('sha256').update(s).digest('hex').slice(0, 16)

async function child(dir, mode) {
  process.chdir(dir)
  const { resolveConfig } = await import(cli('project/config.js'))
  const { pluginState } = await import(cli('server/site.js'))
  const { reportOf } = await import(cli('project/report.js'))
  const { compileServer, compileSlots } = await import(cli('project/compile.js'))
  const { viteLoader } = await import(cli('project/loader.js'))
  const { inspectBoard } = await import(cli('project/inspect.js'))
  const { zipFab } = await import(join(root, 'packages/export/dist/fab.js'))
  const cfg = await resolveConfig([], 'build', undefined, dir, () => {})
  const state = pluginState(cfg)
  const errors = new Map()
  const server = await compileServer(cfg)
  for (const o of runs(mode, state)) {
    await compileSlots(viteLoader(server), cfg, state.slots, errors, o)
  }
  await server.close()
  const lines = []
  for (const s of state.slots) {
    if (!s.compiled) {
      lines.push(`${mode} ${relative(examples, dir)} ${s.entry.rel} error ${sha(String(s.error))}`)
      continue
    }
    const reports = reportOf(cfg, s)
    s.compiled.forEach((c, i) => {
      const b = c.board
      const { stages: _s, routing: _r, snapshot: _n, ...report } = reports[i]
      const lengths = inspectBoard(b, c.entry.rel, cfg.root, undefined, { lengths: true }).text.join('\n')
      const fab = Object.entries(c.fab.files)
        .sort(([a], [z]) => (a < z ? -1 : 1))
        .map(([n, t]) => `${n}:${sha(t)}`)
      const hashes = {
        board: sha(JSON.stringify(b)),
        findings: sha(JSON.stringify(report.findings)),
        lengths: sha(lengths),
        svg: sha(c.svg),
        sch: sha(c.sch ?? ''),
        glb: sha(c.glb ?? ''),
        fab: sha(fab.join() + sha(zipFab(c.fab))),
      }
      const name = `${relative(examples, dir)} ${c.entry.rel}${b.variant ? ` [${b.variant.name}]` : ''}`
      lines.push(
        `${mode} ${name} ${Object.entries(hashes)
          .map(([k, v]) => `${k}=${v}`)
          .join(' ')}`,
      )
      const missed = c.stages.filter(st => st.key && !st.hit).map(st => st.name)
      lines.push(
        `#${mode} ${name} canon=${sha(canonical(b))} ${Object.entries(hashes)
          .filter(([k]) => k !== 'board')
          .map(([k, v]) => `${k}=${v}`)
          .join(' ')} misses=${missed.join(',') || '-'}`,
      )
    })
  }
  process.stdout.write(lines.join('\n') + '\n')
}

/** One compile, or in cancel mode one per stage boundary, each cancelled after one stage more than the last, until one ends: every compile resumes from what the cancelled ones stored. Each goes through the one compileSlots line, so the routes' sources agree. */
function* runs(mode, state) {
  if (mode !== 'cancel') return yield undefined
  for (let k = 1; ; k++) {
    let ended = 0
    const signal = { aborted: false }
    yield { signal, stage: st => st.state !== 'running' && ++ended >= k && (signal.aborted = true) }
    if (!state.slots.some(s => /compile cancelled/.test(String(s.error)))) return
  }
}

const MODES = ['cold', 'cancel', 'warm', 'memo', 'corrupt']
// a run's own counts, which a warm run tells apart from a cold one
const canonical = b => JSON.stringify({ ...b, routing: b.routing && { ...b.routing, cached: undefined, ripped: undefined, rounds: undefined } })

function projects(dir) {
  if (readdirSync(dir).some(f => /^pcb\.config\.(ts|mts|js|mjs)$/.test(f))) return [dir]
  return readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
    .flatMap(e => projects(join(dir, e.name)))
}

function run(dir, mode) {
  const env = { ...process.env, SOURCE_DATE_EPOCH: '1767225600', PCBJS_FREEZE: '1', NODE_ENV: 'production' }
  const r = spawnSync(process.execPath, [import.meta.filename, '--child', dir, mode], { env, encoding: 'utf8', maxBuffer: 64 << 20 })
  if (r.status !== 0) return [`${mode} ${relative(examples, dir)} crashed ${r.stderr.trim().split('\n').slice(-3).join(' | ')}`]
  return r.stdout.trim().split('\n')
}

/** Before a run: the cache emptied, its objects deleted, or the object of one stage overwritten with bytes that are not gzip. */
function prepare(dir, mode) {
  const cache = join(dir, '.pcbjs', 'cache')
  if (mode === 'cold' || mode === 'cancel') for (const d of [cache, join(dir, '.pcbjs', 'routes'), join(dir, '.pcbjs', 'references')]) rmSync(d, { recursive: true, force: true })
  if (mode === 'memo') rmSync(join(cache, 'objects'), { recursive: true, force: true })
  if (mode === 'corrupt') {
    const index = readdirSync(join(cache, 'index')).sort()[0]
    const stages = JSON.parse(readFileSync(join(cache, 'index', index), 'utf8')).stages
    const out = (stages.find(s => s.name === 'finish') ?? stages.find(s => s.out)).out
    writeFileSync(join(cache, 'objects', out.slice(0, 2), `${out}.json.gz`), 'not an object')
  }
}

/** Each board's five runs as one canonical text each; a board whose runs differ, or whose warm run missed a stage, is a failure. */
function agree(lines) {
  const runs = new Map()
  for (const l of lines.filter(l => l.startsWith('#'))) {
    const [mode, ...rest] = l.slice(1).split(' ')
    const misses = rest.pop()
    const key = rest.filter(w => !w.includes('=')).join(' ')
    const hashes = rest.filter(w => w.includes('=')).join(' ')
    if (!runs.has(key)) runs.set(key, {})
    runs.get(key)[mode] = { hashes, misses }
  }
  const bad = []
  for (const [key, by] of runs) {
    const texts = MODES.map(m => by[m]?.hashes ?? 'none')
    if (new Set(texts).size !== 1) bad.push(`${key}: ${MODES.map((m, i) => `${m} ${texts[i]}`).join(' | ')}`)
    if (by.warm?.misses !== 'misses=-') bad.push(`${key}: the warm run missed ${by.warm?.misses}`)
  }
  return { boards: runs.size, bad }
}

const argv = process.argv.slice(2)
if (argv[0] === '--child') await child(argv[1], argv[2])
else {
  const flag = name => {
    const i = argv.indexOf(name)
    return i < 0 ? null : argv.splice(i, 2)[1]
  }
  const save = flag('--save')
  const against = flag('--against')
  const dirs = argv.length ? argv.map(a => join(examples, a)) : projects(examples)
  const lines = []
  for (const dir of dirs)
    for (const mode of MODES) {
      prepare(dir, mode)
      for (const l of run(dir, mode)) {
        lines.push(l)
        if (!l.startsWith('#')) console.log(l)
      }
    }
  const shown = lines.filter(l => !l.startsWith('#'))
  if (save) writeFileSync(save, shown.filter(l => /^(cold|warm) /.test(l)).join('\n') + '\n')
  const { boards, bad } = agree(lines)
  for (const b of bad) console.log(`DIFF  ${b}`)
  console.log(bad.length ? `${bad.length} of ${boards} boards disagree between runs` : `every run of ${boards} boards agrees, the warm run all hits`)
  let diff = []
  if (against) {
    const want = readFileSync(against, 'utf8').trim().split('\n')
    const got = shown.filter(l => /^(cold|warm) /.test(l))
    diff = [...want.filter(l => !got.includes(l)).map(l => `- ${l}`), ...got.filter(l => !want.includes(l)).map(l => `+ ${l}`)]
    console.log(diff.length ? diff.join('\n') : `every hash unchanged, ${got.length} lines`)
  }
  process.exit(diff.length || bad.length || shown.some(l => / crashed /.test(l)) ? 1 : 0)
}
