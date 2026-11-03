// pcbjs test: the demo's tests, one per board, pass in process and through a session; check --test and the report; a golden written with
// --update passes and fails once a track moves; the register hook runs the TypeScript tests on Node 22 too.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { board } from './fixtures/workspace.mjs'
import { stop } from './fixtures/proc.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const BIN = join(REPO, 'packages', 'pcbjs', 'bin', 'pcbjs.js')

const dirs = []
const children = []
after(() => {
  for (const c of children) c.kill('SIGKILL')
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

const linked = root => {
  mkdirSync(join(root, 'node_modules'), { recursive: true })
  symlinkSync(join(REPO, 'node_modules', '@pcbjs'), join(root, 'node_modules', '@pcbjs'), 'dir')
  return root
}
const temp = name => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), `pcbjs-${name}-`)))
  dirs.push(root)
  return root
}

function demo() {
  const root = temp('tests-demo')
  const from = join(REPO, 'examples', 'demo')
  cpSync(from, root, { recursive: true, filter: f => !/\/(node_modules|\.pcbjs)(\/|$)/.test(f.slice(from.length)) })
  return linked(root)
}

const run = (root, args, node = process.execPath) => spawnSync(node, [BIN, ...args], { cwd: root, encoding: 'utf8', timeout: 300000 })

test('the demo: a test per board passes in process, check --test adds them to the report', { timeout: 300000 }, async () => {
  const root = demo()
  const r = run(root, ['test'])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  for (const b of ['Blinky', 'Coin', 'Quad', 'Multi']) assert.match(r.stdout, new RegExp(`✔ ${b}: `), b)
  assert.match(r.stdout, /ℹ pass 5\nℹ fail 0/)
  const snaps = readdirSync(join(root, '.pcbjs', 'test'))
  assert.equal(snaps.length, 1)
  assert.match(snaps[0], /^local-[0-9a-f]{8}$/)
  assert.deepEqual(
    readdirSync(join(root, '.pcbjs', 'test', snaps[0]))
      .filter(f => !f.endsWith('.fab.json'))
      .sort(),
    ['Blinky.json', 'Coin.json', 'Multi-house.json', 'Multi-jlcpcb-2-layer.json', 'Multi-osh-park-2-layer.json', 'Quad.json'],
  )
  const c = run(root, ['check', '--test', '--json', 'report.json'])
  assert.equal(c.status, 0, c.stdout + c.stderr)
  const rep = JSON.parse(readFileSync(join(root, 'report.json'), 'utf8'))
  assert.equal(rep.schema, 'pcbjs.check/1')
  assert.deepEqual([rep.result, rep.tests.status, rep.tests.passed, rep.tests.failed], ['ok', 'ok', 5, 0])
  assert.deepEqual(rep.tests.results[0], { ...rep.tests.results[0], file: 'boards.test.ts', ok: true })
})

test('a board test reads the session’s snapshot, and a failing one fails test and check --test', { timeout: 300000 }, async () => {
  const root = linked(temp('tests-session'))
  writeFileSync(join(root, 'pcb.config.ts'), "import { defineConfig } from '@pcbjs/core'\nexport default defineConfig({ entries: ['pcb.tsx'] })\n")
  writeFileSync(join(root, 'pcb.tsx'), board('Kept'))
  writeFileSync(
    join(root, 'kept.test.ts'),
    `import { test } from 'node:test'
import assert from 'node:assert/strict'
import { board } from '@pcbjs/cli/test'

test('TP2 stays within 12 mm of TP1', () => {
  const b = board()
  const d: number = b.distance('TP1', 'TP2').d
  assert.ok(d <= 12, \`\${d} mm\`)
})
`,
  )
  const child = spawn(process.execPath, [BIN, 'session', 'serve', '--port', '0', '--host', '127.0.0.1'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
  children.push(child)
  let out = ''
  child.stdout.on('data', d => (out += d))
  for (let i = 0; i < 1200 && !/\[pcbjs\] session \w+, pid/.test(out); i++) await new Promise(r => setTimeout(r, 50))
  try {
    const info = JSON.parse(readFileSync(join(root, '.pcbjs', 'dev.json'), 'utf8'))
    const ok = run(root, ['test'])
    assert.equal(ok.status, 0, ok.stdout + ok.stderr)
    assert.match(ok.stderr, new RegExp(`^session ${info.session}  snapshot ${info.session}\\.\\d+`, 'm'))
    assert.deepEqual(readdirSync(join(root, '.pcbjs', 'test'))[0].split('.')[0], info.session)
    writeFileSync(join(root, 'pcb.tsx'), board('Kept').replace('15mm 10mm', '21mm 10mm'))
    const bad = run(root, ['test'])
    assert.equal(bad.status, 1)
    assert.match(bad.stdout, /✖ TP2 stays within 12 mm of TP1/)
    assert.equal(run(root, ['check', '--test']).status, 1)
  } finally {
    await stop(child)
  }
})

test('a golden from --update passes, and fails on a moved track with the layer that differs', { timeout: 300000 }, () => {
  const root = linked(temp('golden'))
  writeFileSync(join(root, 'pcb.config.ts'), "import { defineConfig } from '@pcbjs/core'\nexport default defineConfig({ entries: ['pcb.tsx'] })\n")
  writeFileSync(join(root, 'pcb.tsx'), board('Gold'))
  const u = run(root, ['test', '--update'])
  assert.equal(u.status, 0, u.stdout + u.stderr)
  assert.match(u.stdout, /^golden  golden\/Gold\/  \d+ files$/m)
  assert.ok(existsSync(join(root, 'golden', 'Gold', 'Gold.ipc')))
  assert.match(u.stdout, /✔ golden Gold/)
  // the same board again, a new date in every file: still equal
  const same = run(root, ['test'])
  assert.equal(same.status, 0, same.stdout + same.stderr)
  // the track one millimetre down: the copper differs, the netlist does not
  writeFileSync(join(root, 'pcb.tsx'), board('Gold').replace("route('5 10')", "route('5 11')"))
  const moved = run(root, ['test', '--json', 'r.json'])
  assert.equal(moved.status, 1, moved.stdout + moved.stderr)
  assert.match(moved.stdout, /✖ golden Gold/)
  assert.match(moved.stdout, /Gold-F_Cu\.gtl: [\d.]+ mm² of copper or ink differ from the golden|F_Cu.*differ/)
  assert.doesNotMatch(moved.stdout, /\.ipc: /)
  const rep = JSON.parse(readFileSync(join(root, 'r.json'), 'utf8'))
  assert.deepEqual([rep.command, rep.exit, rep.tests.failed], ['test', 1, 1])
})

// nvm's or Homebrew's Node 22, when the machine has one
const node22 = (() => {
  const dirs = [join(homedir(), '.nvm', 'versions', 'node')]
  for (const d of dirs) {
    if (!existsSync(d)) continue
    const v = readdirSync(d)
      .filter(x => /^v22\./.test(x))
      .sort()
    if (v.length) return join(d, v.at(-1), 'bin', 'node')
  }
  for (const p of ['/opt/homebrew/opt/node@22/bin/node', '/usr/local/opt/node@22/bin/node']) if (existsSync(p)) return p
  return process.version.startsWith('v22.') ? process.execPath : null
})()

test('the register hook runs the TypeScript tests on Node 22 with no flag', { skip: !node22 && 'no Node 22 on this machine', timeout: 300000 }, () => {
  const root = demo()
  const r = run(root, ['test'], node22)
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /ℹ pass 5/)
  assert.doesNotMatch(r.stderr, /ExperimentalWarning|DeprecationWarning/)
})
