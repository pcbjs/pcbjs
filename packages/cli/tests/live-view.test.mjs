import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
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
import { serveSession } from './fixtures/proc.mjs'
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

async function settled(view, from, board, entry) {
  const invalidated = await until(() => view.got.slice(from).find(e => e.event === 'pcbjs:invalidate' && e.board === board))
  return until(() =>
    view.got
      .slice(from)
      .find(
        e =>
          e.event === 'pcbjs:status' &&
          e.phase === 'idle' &&
          e.run > invalidated.edit &&
          view.got.slice(from).some(start => start.event === 'pcbjs:status' && start.entry === entry && start.run === e.run),
      ),
  )
}

async function holdsCurrent(view, board, facets) {
  const held = Object.fromEntries(view.got.filter(e => e.event === 'pcbjs:facet' && e.board === board).map(e => [e.facet, e.hash]))
  const from = view.got.length
  await view.observe(board, facets, { held })
  assert.deepEqual(
    view.got.slice(from).filter(e => e.event === 'pcbjs:facet'),
    [],
    'the pane already holds every current observed facet',
  )
}

async function serve(root) {
  const session = await serveSession(root)
  children.push(session.child)
  return session
}

/** A page as the viewer is to the session: a client observing what it shows, with every event it got. */
const viewer = (port, facets, board = 'Blinky') => viewerClient(port, { board, facets })

test('a schematic view compiles no copper; successive edits settle on the latest placement', { timeout: 180000 }, async () => {
  const root = blinky()
  const s = await serve(root)
  try {
    const v = await viewer(s.port, ['meta', 'sch'])
    await until(() => v.got.some(e => e.event === 'pcbjs:facet' && e.facet === 'sch') && v.got.findLast(e => e.event === 'pcbjs:status')?.phase === 'idle')
    const file = join(root, 'blinky.pcb.tsx')
    const text = readFileSync(file, 'utf8')
    let n = v.got.length
    writeFileSync(file, text.replace('<Q1 at="26 10" />', '<Q1 at="26.5 10" />'))
    const inv = await until(() => v.got.slice(n).find(e => e.event === 'pcbjs:invalidate'))
    assert.ok(inv.refs.includes('Q1'))
    const idle = await until(() => v.got.slice(n).find(e => e.event === 'pcbjs:status' && e.phase === 'idle' && e.run > inv.edit && e.stages?.length))
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
    // Demand copper before editing again.
    await v.observe('Blinky', ['meta', 'layers', 'findings'], { held: {} })
    await until(() => v.got.slice(n).find(e => e.event === 'pcbjs:facet' && e.facet === 'findings'))
    await until(() => v.got.slice(n).findLast(e => e.event === 'pcbjs:status')?.phase === 'idle')
    n = v.got.length
    writeFileSync(file, text.replace('<Q1 at="26 10" />', '<Q1 at="25.5 10" />'))
    await until(() => v.got.slice(n).find(e => e.event === 'pcbjs:facet'))
    n = v.got.length
    writeFileSync(file, text.replace('<Q1 at="26 10" />', '<Q1 at="25 10" />'))
    const latest = await until(() => v.got.slice(n).find(e => e.event === 'pcbjs:invalidate'))
    await until(() => v.got.slice(n).find(e => e.event === 'pcbjs:status' && e.phase === 'idle' && e.run > latest.edit))
    const events = v.got.slice(v.got.indexOf(latest) + 1)
    const facets = events.filter(e => e.event === 'pcbjs:facet')
    assert.ok(
      facets.every(e => e.run > latest.edit),
      'no facets from a superseded edit',
    )
    const meta = v.got.findLast(e => e.event === 'pcbjs:facet' && e.facet === 'meta')
    assert.deepEqual(meta?.data.footprints.find(f => f.ref === 'Q1')?.at, [25, 10])
    await holdsCurrent(v, 'Blinky', ['meta', 'layers', 'findings'])
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
    await Promise.all([settled(flat, n[0], 'Blinky', 'blinky.pcb.tsx'), settled(sch, n[1], 'Blinky', 'blinky.pcb.tsx')])
    const kinds = (v, from) => [...new Set(facets({ got: v.got.slice(from) }).map(e => e.facet))].filter(f => f !== 'fab')
    assert.ok(
      kinds(flat, n[0]).every(f => ['findings', 'layers', 'meta'].includes(f)),
      'the 2D pane: no schematic',
    )
    assert.ok(
      kinds(sch, n[1]).every(f => ['meta', 'sch'].includes(f)),
      'the schematic pane: no copper, no findings',
    )
    for (const v of [flat, sch]) {
      const meta = facets(v).findLast(e => e.facet === 'meta')
      assert.deepEqual(meta.data.footprints.find(f => f.ref === 'Q1').at, [26.5, 10], 'both views hold the edited placement')
    }
    await holdsCurrent(flat, 'Blinky', ['meta', 'layers', 'findings'])
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
    await Promise.all([settled(flat, n[0], 'Blinky', 'blinky.pcb.tsx'), settled(sch, n[1], 'Coin', 'coin.pcb.tsx')])
    await holdsCurrent(flat, 'Blinky', ['meta', 'layers', 'findings'])
    await holdsCurrent(sch, 'Coin', ['meta', 'sch'])
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
