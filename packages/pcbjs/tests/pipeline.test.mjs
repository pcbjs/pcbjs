// The stage graph: plugin stages in both slots, before and after hooks on every stage, registration errors, the views a compile is asked for, and cancellation.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { h } from '@pcbjs/core/jsx-runtime'
import PCB, { route, definePlugin } from '@pcbjs/core'
import { compileBoard, compileStages, sketch, CancelledError, CompileError, STAGES } from '@pcbjs/compile'
import { clearStageCache } from '@pcbjs/compile/internal/cache'
import { clearRouteCache } from '@pcbjs/compile/internal/route-cache'
import { fp, handle } from './parts.mjs'

const edge = () => h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 20, h: 10 })
const smd = (ref, x, y, net) => fp({ ref, at: `${x} ${y}`, nets: { 1: net } }, h('pad', { num: 1, size: 1, type: 'smd' }))
/** Two autorouted legs, A from J1 to J2 and B from J3 to J4. */
const board = (props = {}) =>
  h(
    PCB,
    { name: 'Stages', ...props },
    edge(),
    smd('J1', 3, 3, 'A'),
    smd('J2', 17, 3, 'A'),
    smd('J3', 3, 7, 'B'),
    smd('J4', 17, 7, 'B'),
    route(handle('J1.1'), handle('J2.1')).width(0.25),
    route(handle('J3.1'), handle('J4.1')).width(0.25),
  )
const silk = (x, y) => ({
  kind: 'graphic',
  layer: 'F.SilkS',
  width: 0.15,
  paths: [
    [
      [x, y],
      [x + 1, y],
    ],
  ],
  closed: [false],
  fill: false,
})
/** The stages and plugin steps that ran, without the units of a stage, `<stage>:<unit>`. */
const names = r => r.stages.map(s => s.name).filter(n => !n.includes(':'))

test('stages: every built-in stage runs in the order of the table', () => {
  const [r] = compileStages(board())
  assert.deepEqual(names(r), [...STAGES])
  assert.equal(STAGES.length, 12)
  assert.ok(r.stages.every(s => s.ms >= 0))
})

test('plugins: a stage in each slot adds copper, findings and data the board carries', () => {
  const seen = {}
  const p = definePlugin({
    name: 'probe',
    version: '1',
    stages: [
      {
        name: 'mark',
        slot: 'beforeRoute',
        reads: ['parts'],
        run: (b, ctx) => {
          seen.route = { routing: b.routing, part: ctx.resolve('J1')?.ref, pad: ctx.resolve('J2/1')?.net, net: ctx.resolve('net:A')?.name }
          seen.count = b.items.length
          ctx.log('marked')
          return { add: [silk(1, 1)], data: { before: b.items.length } }
        },
      },
      {
        name: 'audit',
        slot: 'beforeChecks',
        reads: ['copper'],
        run: b => {
          seen.checks = { routed: b.items.filter(i => i.kind === 'track').length, drc: b.drc.length }
          return { findings: [{ severity: 'warning', rule: 'probe.audit', message: 'audited', at: [1, 1] }], data: { tracks: seen.checks.routed } }
        },
      },
    ],
  })
  const [r] = compileStages(board({ plugins: [p] }))
  const b = r.board
  assert.deepEqual(names(r), [
    'evaluate',
    'place',
    'schematic',
    'manualCopper',
    'probe/mark',
    'autoroute',
    'placeFollowers',
    'routeFollowers',
    'tune',
    'patches',
    'finish',
    'probe/audit',
    'checks',
    'exports',
  ])
  assert.deepEqual(r.stages.find(s => s.name === 'probe/mark').log, ['marked'])
  // beforeRoute sees no routing yet, beforeChecks the routed copper and no findings yet
  assert.deepEqual(seen.route, { routing: undefined, part: 'J1', pad: 'A', net: 'A' })
  assert.deepEqual(seen.checks, { routed: 2, drc: 0 })
  const added = b.items.filter(i => i.kind === 'graphic' && i.layer === 'F.SilkS' && i.paths[0][0][0] === 1)
  assert.equal(added.length, 1)
  assert.equal(new Set(b.items.map(i => i.id)).size, b.items.length, 'the added item has an id of its own')
  assert.deepEqual(b.plugins, { probe: { before: seen.count, tracks: 2 } })
  assert.deepEqual(
    b.drc.filter(d => d.rule === 'probe.audit').map(d => d.message),
    ['audited'],
  )
  assert.equal(JSON.parse(JSON.stringify(b)).plugins.probe.tracks, 2)
})

test('plugins: before and after hooks of every stage run in order, and their deltas reach the board', () => {
  const calls = []
  const hook = name => (b, ctx) => {
    calls.push(name)
    assert.equal(ctx.stage, `hooks/${name}`)
    if (name === 'after:manualCopper') return { add: [silk(2, 2)] }
    if (name === 'before:exports') return { findings: [{ kind: 'erc', severity: 'warning', rule: 'hooks.late', message: 'late', at: [0, 0] }] }
    return { data: { [name]: b.items.length > 0 } }
  }
  const allowed = STAGES.slice(1).flatMap(s => (s === 'place' ? [`after:${s}`] : [`before:${s}`, `after:${s}`]))
  const before = Object.fromEntries(allowed.filter(n => n.startsWith('before:')).map(n => [n.slice(7), hook(n)]))
  const after = Object.fromEntries(allowed.filter(n => n.startsWith('after:')).map(n => [n.slice(6), hook(n)]))
  const exported = []
  const [r] = compileStages(board(), { plugins: [{ name: 'hooks', version: '1', before, after }], exports: [{ name: 'probe', run: b => exported.push(b.items.length) }] })
  assert.deepEqual(calls, allowed)
  assert.ok(
    r.board.items.some(i => i.kind === 'graphic' && i.paths[0][0][0] === 2),
    'the after:manualCopper item is on the board',
  )
  assert.deepEqual(Object.keys(r.board.plugins.hooks).sort(), allowed.filter(n => n !== 'after:manualCopper' && n !== 'before:exports').sort())
  assert.ok(Object.values(r.board.plugins.hooks).every(v => v === true))
  assert.deepEqual(
    r.board.erc.filter(f => f.rule === 'hooks.late').map(f => f.message),
    ['late'],
  )
  assert.deepEqual(exported, [r.board.items.length])
})

test('plugins: checks report under their rule after the built-in ones', () => {
  const p = { name: 'si', version: '1', checks: [{ rule: 'si.count', reads: ['copper'], run: b => [{ severity: 'warning', message: `${b.items.length} items`, at: [0, 0] }] }] }
  const b = compileBoard(board(), { plugins: [p] })
  assert.deepEqual(
    b.drc.map(d => d.rule),
    ['si.count'],
  )
})

test('plugins: findings reported before the checks follow the built-in ones in report order, with the same ids from the cache', () => {
  const f = (rule, severity, kind) => ({ ...(kind ? { kind } : {}), severity, rule, message: rule, at: [1, 1] })
  const p = {
    name: 'order',
    version: '1',
    stages: [
      { name: 'early', slot: 'beforeRoute', reads: [], run: () => ({ findings: [f('order.early', 'warning'), f('order.early', 'error'), f('order.sch', 'error', 'erc')] }) },
      { name: 'late', slot: 'beforeChecks', reads: [], run: () => ({ findings: [f('order.late', 'info')] }) },
    ],
    after: { finish: () => ({ findings: [f('order.finish', 'warning')] }), checks: () => ({ findings: [f('order.after', 'error')] }) },
    checks: [{ rule: 'order.check', reads: [], run: () => [f('order.check', 'warning')] }],
  }
  // J5's pad crosses the edge, a built-in error
  const crossing = h(PCB, { name: 'Order' }, edge(), smd('J1', 3, 3, 'A'), smd('J2', 17, 3, 'A'), smd('J5', 0.2, 7, 'C'), route(handle('J1.1'), handle('J2.1')).width(0.25))
  const dir = mkdtempSync(join(tmpdir(), 'pcbjs-order-'))
  const compile = () => {
    clearStageCache()
    clearRouteCache()
    const [r] = compileStages(crossing, { cache: { dir, entry: 'pcb.tsx', files: { '/project/pcb.tsx': 'one' }, env: '' }, plugins: [p] })
    return r
  }
  const cold = compile()
  const warm = compile()
  assert.deepEqual(
    warm.stages.filter(s => ['schematic', 'autoroute', 'tune', 'finish', 'checks'].includes(s.name) && !s.hit).map(s => s.name),
    [],
  )
  const line = m => `${m.severity} ${m.rule}`
  const built = cold.board.drc.filter(m => !m.rule.startsWith('order.'))
  assert.ok(built.length, 'a built-in finding')
  assert.deepEqual(cold.board.drc.map(line), [
    ...built.map(line),
    'warning order.early',
    'error order.early',
    'warning order.finish',
    'info order.late',
    'warning order.check',
    'error order.after',
  ])
  assert.deepEqual(cold.board.erc.filter(m => m.rule.startsWith('order.')).map(line), ['error order.sch'])
  for (const kind of ['drc', 'erc']) {
    assert.ok(cold.board[kind].every(m => m.id && m.fingerprint))
    assert.deepEqual(
      warm.board[kind].map(m => m.id),
      cold.board[kind].map(m => m.id),
    )
  }
})

test('plugins: a name twice, a hook with no board, an unknown slot or a check outside its plugin is a compile error', () => {
  const p = { name: 'twice', version: '1' }
  assert.throws(
    () => compileBoard(board({ plugins: [p] }), { plugins: [p] }),
    e => e instanceof CompileError && /plugin "twice": is registered twice/.test(e.message),
  )
  assert.throws(() => compileBoard(board(), { plugins: [{ name: 'early', version: '1', before: { place: () => {} } }] }), /before\.place has no board to read/)
  assert.throws(() => compileBoard(board(), { plugins: [{ name: 'odd', version: '1', stages: [{ name: 's', slot: 'later', reads: [], run: () => ({}) }] }] }), /slot "later"/)
  assert.throws(() => compileBoard(board(), { plugins: [{ name: 'own', version: '1', checks: [{ rule: 'other.x', reads: [], run: () => [] }] }] }), /must start with own\./)
  assert.throws(
    () => compileBoard(board(), { plugins: [{ name: 'f', version: '1', stages: [{ name: 's', slot: 'beforeRoute', reads: ['wires'], run: () => ({}) }] }] }),
    /reads "wires", not a facet/,
  )
})

test('plugins: under PCBJS_FREEZE a stage that writes its input throws', () => {
  assert.equal(process.env.PCBJS_FREEZE, '1')
  const p = { name: 'rude', version: '1', stages: [{ name: 'w', slot: 'beforeRoute', reads: [], run: b => ((b.items[0].layer = 'B.Cu'), {}) }] }
  assert.throws(() => compileBoard(board(), { plugins: [p] }), TypeError)
})

test('sketch: the keystroke board lays the manual copper of every route, a chain with an automatic leg too, and routes nothing', () => {
  const b = h(PCB, { name: 'Sketch' }, edge(), smd('J1', 3, 3, 'A'), smd('J2', 17, 3, 'A'), route(handle('J1.1'), handle('J2.1')).width(0.25).H(8).X())
  const tracks = sketch(b).board.items.filter(i => i.kind === 'track')
  assert.deepEqual(
    tracks.map(t => [t.pts, t.width]),
    [
      [
        [
          [3, 3],
          [8, 3],
        ],
        0.25,
      ],
    ],
  )
  assert.ok(tracks[0].uid)
  const [full] = compileStages(b)
  assert.deepEqual(full.board.items.find(i => i.id === tracks[0].id)?.pts, tracks[0].pts, 'the compile lays the same piece under the same id')
})

test('demand: the schematic view runs evaluate, place and schematic only; no view list runs everything', () => {
  const [r] = compileStages(board(), { want: ['sch'] })
  assert.deepEqual(names(r), ['evaluate', 'place', 'schematic'])
  assert.ok(r.board.schematic.drawing)
  assert.equal(r.board.routing, undefined)
  assert.equal(r.board.items.filter(i => i.kind === 'track').length, 0)
  const [l] = compileStages(board(), { want: ['layers'] })
  assert.deepEqual(names(l), ['evaluate', 'place', 'manualCopper', 'autoroute', 'placeFollowers', 'routeFollowers', 'tune', 'patches', 'finish'])
  const [f] = compileStages(board(), { want: ['findings'] })
  assert.deepEqual(
    names(f),
    STAGES.filter(s => s !== 'exports'),
  )
  assert.throws(() => compileStages(board(), { want: ['gerbers'] }), /unknown view "gerbers"/)
})

test('cancel: between stages and between router legs, the compile returns nothing and writes no route file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pcbjs-cancel-'))
  const opts = signal => ({ cache: { dir }, signal })
  const between = new AbortController()
  const stopper = { name: 'stop', version: '1', after: { manualCopper: () => void between.abort() } }
  assert.throws(() => compileStages(board(), { ...opts(between.signal), plugins: [stopper] }), CancelledError)
  assert.deepEqual(readdirSync(dir), [])
  const inside = new AbortController()
  const seen = []
  const progress = p => {
    seen.push(p.done)
    if (p.done === 1) inside.abort()
  }
  assert.throws(() => compileStages(board(), { ...opts(inside.signal), progress }), CancelledError)
  assert.deepEqual(seen, [0, 1], 'the cancel lands before the second leg')
  assert.deepEqual(readdirSync(dir), [])
  // uncancelled, the same compile writes its route file
  compileStages(board(), opts(new AbortController().signal))
  assert.deepEqual(readdirSync(join(dir, 'route')), ['Stages.json'])
})

test('cancel: connectivity and DRC check the signal inside the checks stage, not only before it', () => {
  // the signal read on the n-th tick of the checks stage aborts there
  const cancelAt = n => {
    let checks = false,
      reads = 0
    const signal = {
      get aborted() {
        return checks && ++reads >= n
      },
    }
    const stage = e => {
      if (e.name === 'checks') checks = e.state === 'running'
    }
    return { signal, stage, reads: () => reads }
  }
  const all = cancelAt(Infinity)
  compileStages(board(), { signal: all.signal, stage: all.stage })
  assert.ok(all.reads() >= 5, `${all.reads()} cancel points in checks`)
  // the stack of the cancel at the n-th read
  const stackAt = n => {
    const c = cancelAt(n)
    try {
      compileStages(board(), { signal: c.signal, stage: c.stage })
    } catch (e) {
      assert.ok(e instanceof CancelledError, String(e))
      return e.stack
    }
    assert.fail(`no cancel at read ${n}`)
  }
  const stacks = Array.from({ length: all.reads() }, (_, i) => stackAt(i + 1))
  for (const where of [/connectivity/, /\bdrc\b/])
    assert.ok(
      stacks.some(s => where.test(s)),
      `a cancel point inside ${where}`,
    )
})
