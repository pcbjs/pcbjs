import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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
  cpSync(join(REPO, 'examples', 'demo'), root, { recursive: true, filter: s => !/[\\/](?:\.pcbjs|node_modules)$/.test(s) })
  mkdirSync(join(root, 'node_modules'))
  symlinkSync(join(REPO, 'node_modules', '@pcbjs'), join(root, 'node_modules', '@pcbjs'), 'dir')
  const cfg = join(root, 'pcb.config.ts')
  writeFileSync(cfg, readFileSync(cfg, 'utf8').replace(/entries:\s*\[[^\]]*\]/, `entries: ${JSON.stringify(entries)}`))
  return root
}

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
    await Promise.all([settled(flat, n[0], 'Blinky', 'blinky.pcb.tsx'), settled(sch, n[1], 'Coin', 'coin.pcb.tsx')]).catch(error => {
      error.message += '\n' + JSON.stringify([flat, sch].map((v, i) => v.got.slice(n[i]).filter(e => e.event === 'pcbjs:status' || e.event === 'pcbjs:invalidate')))
      throw error
    })
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
    assert.match(doc, /desync incidents\s+1 in \.pcbjs[\\/]log/)
    assert.equal(JSON.parse(execFileSync(process.execPath, [BIN, 'doctor', '--desync'], { cwd: root, encoding: 'utf8' })).condition, 'seq')
    v.close()
  } finally {
    await s.stop()
  }
})
