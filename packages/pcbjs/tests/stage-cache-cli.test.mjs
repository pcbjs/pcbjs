// The stage cache through the CLI: check --cache cold, warm without evaluating, after a comment, with --fresh and --fresh=all, and the layout it leaves.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CHECKS } from '@pcbjs/compile/internal/checks'

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BIN = join(PKG, 'bin', 'pcbjs.js')

const cli = (cwd, ...args) =>
  new Promise(done => {
    execFile(process.execPath, [BIN, ...args], { cwd, env: { ...process.env, NODE_ENV: 'production' }, timeout: 120000 }, (err, stdout, stderr) => {
      done({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr })
    })
  })

const BOARD = `import PCB, { nets, route, pour, defineFootprint, h } from '@pcbjs/core'
const { A, GND } = nets()
const Two = defineFootprint(p => h('footprint', p, h('pad', { num: 1, at: '-1 0', size: 1.6, drill: 0.8 }), h('pad', { num: 2, at: '1 0', size: 1.6, drill: 0.8 })), { pins: ['1', '2'] as const, prefix: 'R' })
const R1 = Two('1k').connect({ 1: A, 2: GND })
const R2 = Two('1k').connect({ 1: A, 2: GND })
export default (
  <PCB name="Cached">
    <rect layer="Edge.Cuts" x={0} y={0} w={30} h={20} />
    <R1 at="5 5" />
    <R2 at="25 15" />
    {route(R1[1], R2[1]).width(0.25)}
    {pour(GND, 'B.Cu', 'M0 0 H30 V20 H0 Z')}
  </PCB>
)
`
/** Each cache line of a check as `stage hit|miss`. */
const stages = out =>
  Object.fromEntries(
    out
      .split('\n')
      .map(l => /^ {2}cache {2}(\S+)\s+(hit|miss)\s+[0-9a-f]{12}$/.exec(l))
      .filter(Boolean)
      .map(m => [m[1], m[2]]),
  )
const routing = out => /routing (\d+) legs?, \d+ routed, \d+ failed, (\d+) cached/.exec(out)
/** The keyed stages and units: a stage, the routing unit, or a unit of finish and of checks, each check one. */
const UNITS = ['evaluate', 'place', 'schematic', 'autoroute', 'tune', 'finish:pours', 'finish:silk', 'checks:connectivity', ...CHECKS.map(c => `checks:${c.rule}`), 'exports']
const every = v => Object.fromEntries(UNITS.map(s => [s, v]))

let root
before(() => {
  root = mkdtempSync(join(tmpdir(), 'pcbjs-stage-cli-'))
  mkdirSync(join(root, 'node_modules'))
  symlinkSync(resolve(PKG, '..', '..', 'node_modules', '@pcbjs'), join(root, 'node_modules', '@pcbjs'), 'dir')
  writeFileSync(join(root, 'pcb.config.ts'), "import { defineConfig } from '@pcbjs/core'\nexport default defineConfig({ entries: ['pcb.tsx'] })\n")
  writeFileSync(join(root, 'pcb.tsx'), BOARD)
})
after(() => rmSync(root, { recursive: true, force: true }))

test('check --cache: cold every stage misses; warm every stage hits without evaluating; a comment stops at place', { timeout: 300000 }, async () => {
  const cold = await cli(root, 'check', '--cache')
  assert.equal(cold.code, 0, cold.stdout + cold.stderr)
  assert.deepEqual(stages(cold.stdout), every('miss'))
  const cache = join(root, '.pcbjs', 'cache')
  for (const p of ['meta.json', 'index/Cached.json', 'objects', 'route/Cached.json']) assert.ok(existsSync(join(cache, p)), p)
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(cache, 'meta.json'), 'utf8'))).sort(), ['compileId', 'format'])
  assert.equal('locks' in JSON.parse(readFileSync(join(cache, 'route', 'Cached.json'), 'utf8')).groups[''], false, 'the route file holds legs and tunes only')

  const warm = await cli(root, 'check', '--cache', '--verbose')
  assert.deepEqual(stages(warm.stdout), every('hit'))
  assert.match(warm.stdout, /^ {2}stage {2}autoroute\s+hit$/m)
  const [, legs, cached] = routing(warm.stdout)
  assert.equal(cached, legs)

  appendFileSync(join(root, 'pcb.tsx'), '// a comment\n')
  const edited = await cli(root, 'check', '--cache')
  assert.deepEqual(stages(edited.stdout), { ...every('hit'), evaluate: 'miss', place: 'miss' })
})

test('--fresh rebuilds every stage from the route memos; --fresh=all reroutes too, and older folders go', { timeout: 300000 }, async () => {
  await cli(root, 'check')
  mkdirSync(join(root, '.pcbjs', 'routes'), { recursive: true })
  const fresh = await cli(root, 'check', '--fresh', '--cache')
  assert.deepEqual(stages(fresh.stdout), every('miss'))
  const [, legs, cached] = routing(fresh.stdout)
  assert.equal(cached, legs, 'the legs come from the memos')
  assert.equal(existsSync(join(root, '.pcbjs', 'routes')), false, 'the folder of the older layout is gone')
  const all = await cli(root, 'check', '--fresh=all', '--cache')
  assert.deepEqual(stages(all.stdout), every('miss'))
  assert.equal(routing(all.stdout)[2], '0', 'every leg routed again')
  const named = await cli(root, 'check', '--fresh', 'pcb.tsx', '--cache')
  assert.equal(named.code, 0, named.stdout + named.stderr)
  assert.deepEqual(stages(named.stdout), every('miss'), 'an entry after a bare --fresh stays an entry')
})
