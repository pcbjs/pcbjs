// The live view: facets in stage order on a cold compile and all at once on a warm start, the invalidate set of a moved part,
// a schematic-only view compiling no copper, a second edit cancelling the first, two panes on two boards each compiling its own
// views, and a view out of sync leaving an incident with no source in it.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveConfig } from '../dist/project/config.js'
import { pluginState } from '../dist/server/site.js'
import { compileServer } from '../dist/project/compile.js'
import { viteLoader } from '../dist/project/loader.js'
import { compileEntry, DATA_FORMATS } from '../dist/project/project.js'
import { FACET_NAMES, facetsOf } from '@pcbjs/core/site-facets'
import { siteFacets } from '../dist/project/facets.js'
import { affected, changedSpans } from '../dist/project/invalidate.js'
import { demanded, STAGES } from '@pcbjs/compile/internal/pipeline'
import { stop } from './fixtures/proc.mjs'
import { viewerClient } from './fixtures/viewer.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const BIN = join(REPO, 'packages', 'pcbjs', 'bin', 'pcbjs.js')
const dirs = []
const children = []
after(() => {
  for (const c of children) c.kill('SIGKILL')
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

/** The demo with these entries, Blinky alone by default, without its caches. */
function blinky(entries = ['blinky.pcb.tsx']) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pcbjs-live-')))
  dirs.push(root)
  cpSync(join(REPO, 'examples', 'demo'), root, { recursive: true, filter: s => !s.includes('/.pcbjs') && !s.includes('/node_modules') })
  mkdirSync(join(root, 'node_modules'))
  symlinkSync(join(REPO, 'node_modules', '@pcbjs'), join(root, 'node_modules', '@pcbjs'), 'dir')
  const cfg = join(root, 'pcb.config.ts')
  writeFileSync(cfg, readFileSync(cfg, 'utf8').replace(/entries:\s*\[[^\]]*\]/, `entries: ${JSON.stringify(entries)}`))
  return root
}

async function compile(root, o = {}) {
  const cfg = await resolveConfig([], 'build', undefined, root, () => {})
  const state = pluginState(cfg)
  const server = await compileServer(cfg)
  try {
    return await compileEntry(viteLoader(server), cfg, state.slots[0].entry, { dev: true, ...o })
  } finally {
    await server.close()
  }
}

test('a cold compile streams its facets as its stages end; a warm start has every facet at once', { timeout: 120000 }, async () => {
  const root = blinky()
  const got = []
  const stages = []
  const last = new Map()
  const [c] = await compile(root, {
    facet: f => (got.push(`${f.facet}@${f.stage}`), last.set(f.facet, f.hash)),
    stage: s => s.state !== 'running' && stages.push(s.name),
  })
  assert.deepEqual(got, [
    'meta@place',
    'layers@place',
    'shapes@place',
    'model@place',
    'sch@schematic',
    'layers@tune',
    'shapes@tune',
    'layers@finish',
    'shapes@finish',
    'findings@checks',
    'fab@exports',
  ])
  assert.deepEqual(stages, ['evaluate', 'place', 'schematic', 'manualCopper', 'autoroute', 'placeFollowers', 'routeFollowers', 'tune', 'patches', 'finish', 'checks', 'exports'])
  // the streamed facets are the finished data's
  const fin = Object.fromEntries(siteFacets(c.site).map(f => [f.facet, f.hash]))
  for (const f of FACET_NAMES) assert.equal(last.get(f), fin[f], f)
  const warm = []
  const [w] = await compile(root, { facet: f => warm.push(f.facet) })
  assert.deepEqual(warm, [], 'served from the cache: nothing streams')
  assert.deepEqual(
    siteFacets(w.site).map(f => f.facet),
    FACET_NAMES,
  )
})

test('a 3D view compiles no exports stage, and a session compile builds no SVG or GLB until asked', { timeout: 120000 }, async () => {
  const root = blinky()
  const got = []
  const stages = []
  const [part] = await compile(root, { want: facetsOf('3d'), facet: f => got.push(f.facet), stage: s => s.state === 'done' && stages.push(s.name) })
  assert.ok(part.partial)
  assert.ok(!stages.includes('exports'), stages.join())
  assert.ok(facetsOf('3d').every(f => got.includes(f)) && !got.includes('fab'), got.join())
  const [c] = await compile(root, { formats: DATA_FORMATS })
  assert.ok(c.fab && c.site)
  assert.equal(c.glb, undefined)
  assert.equal(c.svg, undefined)
  const { glbOf, svgOf } = await import('../dist/project/project.js')
  assert.equal(new TextDecoder().decode(glbOf(c, root).slice(0, 4)), 'glTF')
  assert.match(svgOf(c), /<svg /)
})

test('a moved part makes stale its pads, the legs of its routes and the pours of their layers', { timeout: 120000 }, async () => {
  const root = blinky()
  const [c] = await compile(root)
  const file = join(root, 'blinky.pcb.tsx')
  const before = readFileSync(file, 'utf8')
  const after = before.replace('<Q1 at="26 10" />', '<Q1 at="26.5 10" />')
  const inv = affected(c, 1, [{ rel: 'blinky.pcb.tsx', abs: file, spans: changedSpans(before, after) }])
  const uids = new Set(inv.uids)
  const b = c.board
  assert.ok(inv.refs.includes('Q1'))
  for (const it of b.items.filter(i => i.kind === 'pad' && i.ref === 'Q1')) assert.ok(uids.has(it.uid), `pad ${it.num}`)
  const routed = b.items.filter(i => (i.kind === 'track' || i.kind === 'via') && i.route && uids.has(i.uid))
  assert.ok(routed.length, 'the legs of its routes')
  const layers = new Set(b.items.filter(i => uids.has(i.uid) && i.kind !== 'zone').flatMap(i => (i.kind === 'pad' || i.kind === 'via' ? i.layers : [i.layer])))
  for (const z of b.items.filter(i => i.kind === 'zone')) assert.equal(uids.has(z.uid), layers.has(z.layer), `the pour on ${z.layer}`)
  assert.ok(
    b.items.some(i => i.kind === 'zone' && uids.has(i.uid)),
    'a pour of their layers',
  )
  assert.ok(!uids.has(b.items.find(i => i.kind === 'pad' && i.ref === 'J1').uid), 'a part far from the edit stays')
  assert.ok(
    inv.refs.some(r => r.startsWith('net:')),
    'the nets of its pads, for the ratsnest',
  )
})

async function until(fn, ms = 60000) {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - t0 > ms) throw new Error('timed out')
    await new Promise(r => setTimeout(r, 50))
  }
}

async function serve(root) {
  const child = spawn(process.execPath, [BIN, 'session', 'serve', '--port', '0', '--host', '127.0.0.1'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
  children.push(child)
  let out = ''
  child.stdout.on('data', d => (out += d))
  child.stderr.on('data', d => (out += d))
  await until(() => /\[pcbjs\] session \w+, pid/.test(out))
  const info = JSON.parse(readFileSync(join(root, '.pcbjs', 'dev.json'), 'utf8'))
  return {
    port: new URL(info.url).port,
    log: () => out,
    stop: async () => {
      await stop(child)
    },
  }
}

/** A page as the viewer is to the session: a client observing what it shows, with every event it got. */
const viewer = (port, facets, board = 'Blinky') => viewerClient(port, { board, facets })

test('a schematic view compiles no copper; a second edit cancels the first compile and sends its own invalidate', { timeout: 180000 }, async () => {
  const root = blinky()
  const s = await serve(root)
  try {
    const v = await viewer(s.port, ['meta', 'sch'])
    await until(() => v.got.find(e => e.event === 'session/state' && e.run))
    const file = join(root, 'blinky.pcb.tsx')
    const text = readFileSync(file, 'utf8')
    let n = v.got.length
    writeFileSync(file, text.replace('<Q1 at="26 10" />', '<Q1 at="26.5 10" />'))
    const inv = await until(() => v.got.slice(n).find(e => e.event === 'pcbjs:invalidate'))
    assert.ok(inv.refs.includes('Q1'))
    const idle = await until(() => v.got.slice(n).find(e => e.event === 'pcbjs:status' && e.phase === 'idle' && e.run !== inv.run && e.stages?.length))
    const run = v.got.slice(n)
    assert.deepEqual(
      run.filter(e => e.event === 'pcbjs:facet' && e.run === idle.run).map(e => `${e.facet}@${e.stage}`),
      ['meta@place', 'sch@schematic'],
      'the layers the place stage made go to no one',
    )
    assert.deepEqual(
      idle.stages.map(g => g.name),
      ['evaluate', 'place', 'schematic'],
      'no stage of the copper side runs',
    )
    // a 2D view now: the copper compiles for it, then two edits in a row, the second cancelling the first
    await v.observe('Blinky', ['meta', 'layers', 'findings'], { held: {} })
    await until(() => v.got.slice(n).find(e => e.event === 'pcbjs:facet' && e.facet === 'findings'))
    await until(() => v.got.slice(n).findLast(e => e.event === 'pcbjs:status')?.phase === 'idle')
    n = v.got.length
    writeFileSync(file, text.replace('<Q1 at="26 10" />', '<Q1 at="25.5 10" />'))
    await until(() => v.got.slice(n).find(e => e.event === 'pcbjs:facet'))
    writeFileSync(file, text.replace('<Q1 at="26 10" />', '<Q1 at="25 10" />'))
    await until(() => v.got.slice(n).filter(e => e.event === 'pcbjs:invalidate').length === 2)
    await until(() => v.got.slice(n).findLast(e => e.event === 'pcbjs:status')?.phase === 'idle' && v.got.slice(n).some(e => e.event === 'pcbjs:facet' && e.facet === 'findings'))
    const two = v.got.slice(n)
    const [a, b] = two.filter(e => e.event === 'pcbjs:invalidate').map(e => two.indexOf(e))
    assert.ok(!two.slice(a, b).some(e => e.event === 'pcbjs:status' && e.phase === 'idle'), 'the first compile ends with no idle of its own')
    const snaps = [...new Set(two.filter(e => e.event === 'pcbjs:facet').map(e => e.run))]
    assert.ok(snaps.length >= 2, 'two compiles streamed')
    assert.ok(!two.some(e => e.event === 'pcbjs:facet' && e.facet === 'findings' && e.run === snaps[0]), 'the cancelled one never reached the checks')
    assert.match(s.log(), /an edit cancelled the compile/)
    v.close()
  } finally {
    await s.stop()
  }
})

test('each view gets the facets it observes: a 2D and a schematic pane on one board, and a mode switch fetches what the pane lacks', { timeout: 180000 }, async () => {
  const root = blinky()
  const s = await serve(root)
  try {
    const flat = await viewer(s.port, ['meta', 'layers', 'findings'])
    const sch = await viewer(s.port, ['meta', 'sch'])
    const facets = v => v.got.filter(e => e.event === 'pcbjs:facet')
    await until(() => facets(flat).some(e => e.facet === 'findings') && facets(sch).some(e => e.facet === 'sch'))
    await until(() => [flat, sch].every(v => v.got.findLast(e => e.event === 'pcbjs:status')?.phase === 'idle'))
    const file = join(root, 'blinky.pcb.tsx')
    const n = [flat.got.length, sch.got.length]
    writeFileSync(file, readFileSync(file, 'utf8').replace('<Q1 at="26 10" />', '<Q1 at="26.5 10" />'))
    await until(() => facets({ got: flat.got.slice(n[0]) }).some(e => e.facet === 'findings') && facets({ got: sch.got.slice(n[1]) }).some(e => e.facet === 'sch'))
    await until(() => [flat, sch].every(v => v.got.findLast(e => e.event === 'pcbjs:status')?.phase === 'idle'))
    // fab goes to both when its content changed
    const kinds = (v, from) => [...new Set(facets({ got: v.got.slice(from) }).map(e => e.facet))].filter(f => f !== 'fab').sort()
    assert.deepEqual(kinds(flat, n[0]), ['findings', 'layers', 'meta'], 'the 2D pane: no schematic')
    assert.deepEqual(kinds(sch, n[1]), ['meta', 'sch'], 'the schematic pane: no copper, no findings')
    // the schematic pane switches to 2D with the hashes it holds: the session sends the layers and findings it lacks
    const held = Object.fromEntries(facets(sch).map(e => [e.facet, e.hash]))
    const m = sch.got.length
    await sch.observe('Blinky', ['meta', 'layers', 'findings'], { held })
    await until(() => ['layers', 'findings'].every(f => facets({ got: sch.got.slice(m) }).some(e => e.facet === f)))
    assert.ok(!facets({ got: sch.got.slice(m) }).some(e => e.facet === 'meta' || e.facet === 'sch'), 'nothing it holds is sent again')
    const beat = await until(() => sch.got.slice(m).find(e => e.event === 'session/state') ?? flat.got.slice(n[0]).find(e => e.event === 'session/state' && e.run))
    assert.ok(
      Object.keys(beat.facets).some(k => k.startsWith('sch:')),
      'the heartbeat still names every facet',
    )
    flat.close()
    sch.close()
  } finally {
    await s.stop()
  }
})

test('two panes on two boards: each board compiles only the views of its own pane', { timeout: 180000 }, async () => {
  const root = blinky(['blinky.pcb.tsx', 'coin.pcb.tsx'])
  const s = await serve(root)
  try {
    const flat = await viewer(s.port, ['meta', 'layers', 'findings'], 'Blinky')
    const sch = await viewer(s.port, ['meta', 'sch'], 'Coin')
    const facets = (v, board, from = 0) => v.got.slice(from).filter(e => e.event === 'pcbjs:facet' && e.board === board)
    const idle = () => [flat, sch].every(v => v.got.findLast(e => e.event === 'pcbjs:status')?.phase === 'idle')
    await until(() => facets(flat, 'Blinky').some(e => e.facet === 'findings') && facets(sch, 'Coin').some(e => e.facet === 'sch') && idle())
    const n = [flat.got.length, sch.got.length]
    for (const f of ['blinky.pcb.tsx', 'coin.pcb.tsx']) writeFileSync(join(root, f), readFileSync(join(root, f), 'utf8') + '\n// edited\n')
    await until(() => facets(flat, 'Blinky', n[0]).some(e => e.facet === 'layers') && facets(sch, 'Coin', n[1]).some(e => e.facet === 'sch'))
    await until(idle)
    const statuses = flat.got.slice(n[0]).filter(e => e.event === 'pcbjs:status' && e.entry)
    const planned = entry => statuses.findLast(e => e.entry === entry)?.stages.map(g => g.name)
    const stagesOf = views => STAGES.filter(n => demanded(views).has(n))
    assert.deepEqual(planned('blinky.pcb.tsx'), stagesOf(['meta', 'layers', 'findings']), 'Blinky: copper and checks, no exports')
    assert.deepEqual(planned('coin.pcb.tsx'), stagesOf(['meta', 'sch']), 'Coin: no copper')
    assert.ok(!planned('coin.pcb.tsx').includes('autoroute'))
    // each pane gets its own board's facets and the other board's meta only
    assert.ok(!facets(flat, 'Coin', n[0]).some(e => e.facet !== 'meta'))
    assert.ok(!facets(sch, 'Blinky', n[1]).some(e => e.facet !== 'meta'))
    flat.close()
    sch.close()
  } finally {
    await s.stop()
  }
})

test('a view out of sync resyncs and leaves an incident with no design source in it; doctor lists and prints it', { timeout: 120000 }, async () => {
  const root = blinky()
  const s = await serve(root)
  try {
    const v = await viewer(s.port, ['meta', 'layers', 'model', 'findings'])
    await until(() => v.got.find(e => e.event === 'session/state' && e.run))
    const n = v.got.length
    const inc = await v.request('session/resync', {
      condition: 'seq',
      expected: 7,
      got: 9,
      board: 'Blinky',
      held: { meta: '0'.repeat(16) },
      timeline: [{ t: 1, event: 'pcbjs:facet', seq: 6, facet: 'meta', data: 'LedChannelRow' }],
    })
    assert.ok(
      ['meta', 'layers', 'model', 'findings', 'fab'].every(f => v.got.slice(n).some(e => e.event === 'pcbjs:facet' && e.facet === f)) &&
        !v.got.slice(n).some(e => e.event === 'pcbjs:facet' && e.facet === 'sch'),
      'every facet it observes again, and fab',
    )
    assert.match(inc.url, /^https:\/\/github\.com\/pcbjs\/pcbjs\/issues\/new\?/)
    const files = readdirSync(join(root, '.pcbjs', 'log')).filter(f => f.endsWith('-desync.json'))
    assert.equal(files.length, 1)
    const text = readFileSync(join(root, '.pcbjs', 'log', files[0]), 'utf8')
    const body = JSON.parse(text)
    assert.equal(body.condition, 'seq')
    assert.deepEqual(body.seq, { sent: body.seq.sent, expected: 7, got: 9 })
    assert.ok(body.hashes.session['meta:Blinky'])
    assert.deepEqual(body.interest.facets, ['meta', 'layers', 'model', 'findings'])
    for (const word of ['LedChannelRow', 'roundedRect', 'Brand']) assert.ok(!text.includes(word), `no source: ${word}`)
    const doc = execFileSync(process.execPath, [BIN, 'doctor'], { cwd: root, encoding: 'utf8' })
    assert.match(doc, /desync incidents\s+1 in \.pcbjs\/log/)
    assert.equal(JSON.parse(execFileSync(process.execPath, [BIN, 'doctor', '--desync'], { cwd: root, encoding: 'utf8' })).condition, 'seq')
    v.close()
  } finally {
    await s.stop()
  }
})
