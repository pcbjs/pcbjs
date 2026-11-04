// The stage cache: each stage missed by an edit of what it reads and hit otherwise, early cutoff, corrupt and missing objects, another compiler, the prune, drafts and a cancel.
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import PCB, { h, nets, defineFootprint, pour, route, Schematic, Place } from '@pcbjs/core'
import { compileStages, CancelledError } from '@pcbjs/compile'
import { clearStageCache, setCompileId } from '@pcbjs/compile/internal/cache'
import { clearRouteCache } from '@pcbjs/compile/internal/route-cache'

const { A, GND } = nets()
const Two = defineFootprint(p => h('footprint', p, h('pad', { num: 1, at: '-1 0', size: 1.6, drill: 0.8 }), h('pad', { num: 2, at: '1 0', size: 1.6, drill: 0.8 })), {
  pins: ['1', '2'],
  prefix: 'R',
})
const R1 = Two('1k', { ref: 'R1' }).connect({ 1: A, 2: GND })
const R2 = Two('1k', { ref: 'R2' }).connect({ 1: A, 2: GND })

/** Two resistors, a routed A between them and a GND pour on the back; each option edits what one stage reads. */
const board = (o = {}) =>
  h(
    PCB,
    { name: 'Cache', teardrops: o.drops ?? false, ...(o.at ? { schematic: { drawing: h(Schematic, {}, h(Place, { part: R1, at: o.at })) } } : {}) },
    h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 30, h: 20 }),
    h(R1, { at: '5 5' }),
    h(R2, { at: '25 15' }),
    h('text', { layer: 'F.SilkS', at: '15 3', size: 1 }, o.label ?? 'Cache'),
    ...(o.model ? [h(o.model, { at: '15 10' })] : []),
    route(R1[1], R2[1]).width(o.width ?? 0.25),
    pour(GND, 'B.Cu', 'M0 0 H30 V20 H0 Z'),
  )
const checker = version => ({ name: 'probe', version, cache: true, checks: [{ rule: 'probe.none', reads: ['parts'], run: () => [] }] })

/** One compile as a fresh process makes it: nothing kept in memory, everything read from `dir`. */
function compile(dir, o = {}) {
  clearStageCache()
  clearRouteCache()
  const [r] = compileStages(board(o), {
    cache: { dir, entry: 'pcb.tsx', files: { '/project/pcb.tsx': o.file ?? 'one' }, env: '', ...(o.draft ? { draft: true } : {}) },
    exports: [{ name: 'count', key: o.key ?? '1', run: b => b.items.length }],
    plugins: [checker(o.check ?? '1'), ...(o.plugins ?? [])],
    ...(o.signal ? { signal: o.signal } : {}),
  })
  return r
}
const CACHED = ['schematic', 'autoroute', 'tune', 'finish', 'checks', 'exports']
/** Each cached stage as hit or miss. */
const outcome = r => Object.fromEntries(CACHED.map(n => [n, r.stages.find(s => s.name === n)?.hit ? 'hit' : 'miss']))
const all = v => Object.fromEntries(CACHED.map(n => [n, v]))
const canonical = b => JSON.stringify({ ...b, routing: { ...b.routing, cached: 0, ripped: 0, rounds: 0 } })
const objects = dir => (existsSync(join(dir, 'objects')) ? readdirSync(join(dir, 'objects')).flatMap(d => readdirSync(join(dir, 'objects', d))) : [])
const index = dir => JSON.parse(readFileSync(join(dir, 'index', 'Cache.json'), 'utf8'))
const objectOf = (dir, stage) => {
  const h = index(dir).stages.find(s => s.name === stage).out
  return join(dir, 'objects', h.slice(0, 2), `${h}.json.gz`)
}

let dir
const fresh = () => (dir = mkdtempSync(join(tmpdir(), 'pcbjs-stages-')))
afterEach(() => {
  setCompileId(null)
  if (dir) rmSync(dir, { recursive: true, force: true })
})

test('stage cache: a second compile hits every stage and gives the same board, findings and exports', () => {
  fresh()
  const cold = compile(dir)
  assert.deepEqual(outcome(cold), all('miss'))
  const warm = compile(dir)
  assert.deepEqual(outcome(warm), all('hit'))
  assert.equal(canonical(warm.board), canonical(cold.board))
  assert.deepEqual(warm.exports, cold.exports)
  assert.equal(warm.board.routing.cached, warm.board.routing.legs, 'every leg told as cached')
  assert.ok(warm.stages.every(s => !s.key || /^[0-9a-f]{40}$/.test(s.key)))
})

test('stage cache: an edit misses the stage that reads it and what its output changes, never a stage before it', () => {
  fresh()
  compile(dir)
  assert.deepEqual(outcome(compile(dir, { at: '20 10' })), { ...all('hit'), schematic: 'miss', exports: 'miss' }, 'the schematic drawing')
  compile(dir)
  assert.deepEqual(outcome(compile(dir, { width: 0.3 })), { ...all('miss'), schematic: 'hit' }, 'a route width')
  compile(dir)
  assert.deepEqual(outcome(compile(dir, { drops: true })), { ...all('miss'), schematic: 'hit', autoroute: 'hit', tune: 'hit' }, 'teardrops')
  compile(dir)
  assert.deepEqual(outcome(compile(dir, { check: '2' })), { ...all('hit'), checks: 'miss' }, 'a plugin check of another version')
  compile(dir)
  assert.deepEqual(outcome(compile(dir, { key: '2' })), { ...all('hit'), exports: 'miss' }, 'an export format reading something else')
})

test('stage cache: a silk label edit restores the routing and the tuning, as a cold compile of it would, the route memos kept', () => {
  fresh()
  compile(dir)
  const warm = compile(dir, { label: 'Other' })
  assert.deepEqual(outcome(warm), { ...all('miss'), schematic: 'hit', autoroute: 'hit', tune: 'hit' })
  assert.deepEqual(
    warm.stages.filter(s => s.key && !s.hit && s.name.startsWith('finish:')).map(s => s.name),
    ['finish:silk'],
    'the pours hit, the silk refs run',
  )
  const memo = readFileSync(join(dir, 'route', 'Cache.json'), 'utf8')
  const edited = dir
  fresh()
  const cold = compile(dir, { label: 'Other' })
  assert.equal(canonical(warm.board), canonical(cold.board))
  assert.equal(memo, readFileSync(join(dir, 'route', 'Cache.json'), 'utf8'))
  rmSync(edited, { recursive: true, force: true })
})

test('stage cache: a file edit that leaves the placed board as it was stops at place', () => {
  fresh()
  const cold = compile(dir)
  const edited = compile(dir, { file: 'one, with a comment' })
  assert.notEqual(edited.stages.find(s => s.name === 'evaluate').key, cold.stages.find(s => s.name === 'evaluate').key)
  assert.notEqual(edited.stages.find(s => s.name === 'place').key, cold.stages.find(s => s.name === 'place').key)
  assert.deepEqual(outcome(edited), all('hit'))
  assert.equal(canonical(edited.board), canonical(cold.board))
})

/** R2 placed by the placer from 25 15, with an at:cost when given. */
function placed(file, cost) {
  clearStageCache()
  clearRouteCache()
  const R = h(R2, { at: 'auto', 'at:initial': '25 15', ...(cost ? { 'at:cost': cost } : {}) })
  const [r] = compileStages(h(PCB, { name: 'Cache' }, h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 30, h: 20 }), h(R1, { at: '5 5' }), R, route(R1[1], R2[1])), {
    cache: { dir, entry: 'pcb.tsx', files: { '/project/pcb.tsx': file }, env: '' },
  })
  return r
}

test('stage cache: the placement is kept by its inputs, so a file edit elsewhere runs no placer', () => {
  fresh()
  const placer = r => r.stages.find(s => s.name === 'place:placer')?.hit
  const cold = placed('one')
  assert.equal(placer(cold), false)
  const edited = placed('one, with a comment')
  assert.notEqual(edited.stages.find(s => s.name === 'place').key, cold.stages.find(s => s.name === 'place').key)
  assert.equal(placer(edited), true)
  assert.equal(canonical(edited.board), canonical(cold.board))
  assert.equal(placer(compile(dir)), undefined, 'a board with no auto slot has no placer')
})

test('stage cache: a placement with an at:cost hits for the same sources and runs again for edited ones', () => {
  fresh()
  let calls = 0
  const cost = () => (calls++, 0)
  const cold = placed('one', cost)
  assert.ok(calls > 0)
  calls = 0
  const warm = placed('one', cost)
  assert.equal(calls, 0, 'no placer run')
  assert.equal(canonical(warm.board), canonical(cold.board))
  placed('one, edited', cost)
  assert.ok(calls > 0, 'a cost function is code, so an edit runs it again')
})

test('stage cache: a corrupt or missing object is a miss, rebuilt to the same output', () => {
  fresh()
  const cold = compile(dir)
  writeFileSync(objectOf(dir, 'finish:pours'), 'not gzip')
  const corrupt = compile(dir)
  assert.deepEqual(outcome(corrupt), { ...all('hit'), finish: 'miss' })
  assert.equal(canonical(corrupt.board), canonical(cold.board))
  rmSync(objectOf(dir, 'checks:clearance'))
  const missing = compile(dir)
  assert.deepEqual(outcome(missing), { ...all('hit'), checks: 'miss' })
  assert.equal(canonical(missing.board), canonical(cold.board))
  rmSync(join(dir, 'objects'), { recursive: true })
  const memo = compile(dir)
  assert.deepEqual(outcome(memo), all('miss'))
  assert.equal(memo.board.routing.cached, memo.board.routing.legs, 'the route memos survive the objects')
  assert.equal(canonical(memo.board), canonical(cold.board))
})

test('stage cache: another compiler misses every object and keeps every leg', () => {
  fresh()
  const cold = compile(dir)
  setCompileId({ compile: 'another compiler' })
  const next = compile(dir)
  assert.deepEqual(outcome(next), all('miss'))
  assert.equal(next.board.routing.cached, next.board.routing.legs)
  assert.equal(canonical(next.board), canonical(cold.board))
})

test('stage cache: another core under the same compiler misses the checks and keeps every leg', () => {
  fresh()
  compile(dir)
  setCompileId({ compile: 'one compiler', core: 'one core' })
  compile(dir)
  assert.deepEqual(outcome(compile(dir)), all('hit'))
  setCompileId({ compile: 'one compiler', core: 'another core' })
  const next = compile(dir)
  assert.equal(outcome(next).checks, 'miss')
  assert.deepEqual(outcome(next), all('miss'))
  assert.equal(next.board.routing.cached, next.board.routing.legs)
})

test('stage cache: the prune keeps what the current and the previous index name and nothing else', () => {
  fresh()
  compile(dir, { width: 0.25 })
  const first = new Set(objects(dir))
  compile(dir, { width: 0.3 })
  const second = new Set(objects(dir))
  for (const o of first) assert.ok(second.has(o), 'the previous compile keeps its objects')
  compile(dir, { width: 0.35 })
  const third = new Set(objects(dir))
  const named = new Set([index(dir), index(dir).previous].flatMap(r => r.stages.filter(s => s.out).map(s => `${s.out}.json.gz`)))
  assert.deepEqual([...third].sort(), [...named].sort())
  assert.ok(
    [...first].some(o => !third.has(o)),
    'the first compile is pruned',
  )
  assert.deepEqual(outcome(compile(dir, { width: 0.3 })), { ...all('hit'), schematic: 'hit' }, 'an undo hits the previous index')
})

test('stage cache: a draft reads the cache and writes neither index nor objects', () => {
  fresh()
  compile(dir)
  const before = objects(dir).sort()
  const stamp = readFileSync(join(dir, 'index', 'Cache.json'), 'utf8')
  const draft = compile(dir, { draft: true, width: 0.3 })
  assert.equal(outcome(draft).schematic, 'hit')
  assert.equal(outcome(draft).autoroute, 'miss')
  assert.deepEqual(objects(dir).sort(), before)
  assert.equal(readFileSync(join(dir, 'index', 'Cache.json'), 'utf8'), stamp)
})

test('stage cache: the stages a cancel lets finish are stored and the next compile reuses them', () => {
  fresh()
  const ctrl = new AbortController()
  let stop = true
  const stopper = { name: 'stopper', version: '1', after: { patches: () => void (stop && ctrl.abort()) } }
  assert.throws(() => compile(dir, { plugins: [stopper], signal: ctrl.signal }), CancelledError)
  stop = false
  const next = compile(dir, { plugins: [stopper] })
  assert.deepEqual(outcome(next), { ...all('hit'), finish: 'miss', checks: 'miss', exports: 'miss' })
})

test('configured plugins key closure inputs; plugins without an explicit cache contract rerun', () => {
  fresh()
  let calls = 0
  const plugin = (limit, keyed) => ({
    name: 'limit',
    version: '1',
    ...(keyed ? { cacheKey: JSON.stringify({ limit }) } : {}),
    checks: [
      {
        rule: 'limit.width',
        reads: ['outline'],
        run: () => {
          calls++
          return limit < 30 ? [{ rule: 'limit.width', severity: 'warning', message: `limit ${limit}` }] : []
        },
      },
    ],
  })
  const run = (limit, keyed) => compile(dir, { plugins: [plugin(limit, keyed)] })
  run(80, true)
  run(80, true)
  assert.equal(calls, 1, 'same configuration hits')
  const warm = run(20, true)
  assert.equal(calls, 2, 'changed configuration misses')
  assert.ok(warm.board.drc.some(f => f.rule === 'limit.width'))
  const previous = dir
  fresh()
  assert.equal(canonical(warm.board), canonical(run(20, true).board), 'warm and cold outputs agree')
  rmSync(previous, { recursive: true, force: true })
  calls = 0
  run(80, false)
  run(20, false)
  assert.equal(calls, 2, 'unkeyed closures are uncached by default')
  assert.equal(index(dir).complete, false, 'startup cannot bypass uncached plugin execution')
})

test('stage cache: a model file that appears, changes or goes misses the model check and the exports, and the index lists it', () => {
  fresh()
  // the last test: a part declared here must be placed by every later compile
  const MODEL = join(dir, 'R3.step')
  const R3 = Two('1k', { ref: 'R3', model: { file: MODEL } })
  const missing = r => r.board.erc.filter(m => m.rule === 'model-missing').map(m => m.refs[0])
  const cold = compile(dir, { model: R3 })
  assert.deepEqual(missing(cold), ['R3'])
  assert.equal(index(dir).files[MODEL], 'missing')
  assert.deepEqual(outcome(compile(dir, { model: R3 })), all('hit'))
  writeFileSync(MODEL, 'ISO-10303-21;\n')
  const arrived = compile(dir, { model: R3 })
  assert.deepEqual(missing(arrived), [])
  assert.deepEqual(outcome(arrived), { ...all('hit'), checks: 'miss', exports: 'miss' })
  assert.deepEqual(
    arrived.stages.filter(s => s.key && !s.hit).map(s => s.name),
    ['evaluate', 'place', 'checks:model', 'exports'],
  )
  assert.match(index(dir).files[MODEL], /^[0-9a-f]{40}$/)
  writeFileSync(MODEL, 'ISO-10303-21;\nEND-ISO-10303-21;\n')
  assert.deepEqual(outcome(compile(dir, { model: R3 })), { ...all('hit'), checks: 'miss', exports: 'miss' }, 'a changed file')
  rmSync(MODEL)
  const gone = compile(dir, { model: R3 })
  assert.deepEqual(missing(gone), ['R3'])
  assert.equal(gone.stages.find(s => s.name === 'checks').hit, false)
})
