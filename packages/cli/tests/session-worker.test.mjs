// The session's compile in a worker thread per project: an edit's cancel lands within one unit and the next compile reuses
// nothing stale, a crashed thread is restarted once, and two projects with their own defaults, KiCad libraries and fonts,
// compiled alternately, give what each gives in process.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { workerCompiler } from '../dist/session/worker-client.js'
import { connectSession } from '../dist/session/client.js'
import { stop } from './fixtures/proc.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const BIN = join(REPO, 'packages', 'pcbjs', 'bin', 'pcbjs.js')
const FONT = join(REPO, 'packages', 'core', 'tests', 'fixtures', 'fonts', 'RobotoSlab-subset.ttf')

const dirs = []
const children = []
after(() => {
  for (const c of children) c.kill('SIGKILL')
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

const tmp = prefix => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  dirs.push(d)
  return d
}
const linkPackages = root => {
  mkdirSync(join(root, 'node_modules'), { recursive: true })
  symlinkSync(join(REPO, 'node_modules', '@pcbjs'), join(root, 'node_modules', '@pcbjs'), 'dir')
}

/** A review board copied without its caches, so it compiles cold. */
function example(name) {
  const root = tmp(`pcbjs-${name}-`)
  cpSync(join(REPO, 'examples', name), root, { recursive: true, filter: s => !s.includes('/.pcbjs') })
  if (!existsSync(join(root, 'node_modules'))) linkPackages(root)
  return root
}

// the board without what differs between two equal compiles: the router's cache counts and the timings
const plain = board => JSON.stringify({ ...board, routing: undefined, timings: undefined })

test('a cancel from an edit lands within one unit, and the next compile reuses nothing stale', { timeout: 180000 }, async () => {
  const root = example('eth-phy')
  const file = join(root, 'pcb.tsx')
  const entry = { file, rel: 'pcb.tsx' }
  const c = workerCompiler({ root, configFile: join(root, 'pcb.config.ts'), log: () => {} })
  let at = 0
  let routing = () => {}
  const started = new Promise(r => (routing = r))
  const job = c.compile(entry, { draft: true, progress: p => p.legs && routing() })
  await started
  // the router is past its first leg: the edit cancels it there
  c.cancel()
  at = performance.now()
  await assert.rejects(job, e => e.name === 'CancelledError')
  const late = performance.now() - at
  assert.ok(late < 1000, `cancelled ${Math.round(late)} ms after the flag`)
  const edited = readFileSync(file, 'utf8').replace('<R3 at="40 10" />', '<R3 at="40.5 10" />')
  assert.notEqual(edited, readFileSync(file, 'utf8'))
  c.draft(file, { code: edited, limit: null })
  const [next] = await c.compile(entry, { draft: true })
  await c.close()
  const fresh = workerCompiler({ root, configFile: join(root, 'pcb.config.ts'), log: () => {} })
  fresh.draft(file, { code: edited, limit: null })
  const [cold] = await fresh.compile(entry, { draft: true })
  await fresh.close()
  assert.equal(next.board.footprints.find(f => f.ref === 'R3').at[0], 40.5)
  assert.equal(plain(next.board), plain(cold.board))
  assert.ok(!existsSync(join(root, '.pcbjs', 'routes')), 'a draft compile writes no route file')
})

test('a crashed compile thread is restarted once with its compile, and twice in a row fails the compile only', { timeout: 120000 }, async () => {
  const root = tmp('pcbjs-crash-')
  linkPackages(root)
  writeFileSync(join(root, 'pcb.config.ts'), "import { defineConfig } from '@pcbjs/core'\nexport default defineConfig({ entries: ['pcb.tsx'] })\n")
  const mark = join(root, 'crashed')
  const design = always => `import PCB from '@pcbjs/core'
import { existsSync, writeFileSync } from 'node:fs'
if (${always ? 'true' : `!existsSync(${JSON.stringify(mark)})`}) {
  writeFileSync(${JSON.stringify(mark)}, '')
  process.exit(7)
}
export default <PCB name="Crash"><rect layer="Edge.Cuts" x={0} y={0} w={10} h={10} /></PCB>
`
  const file = join(root, 'pcb.tsx')
  writeFileSync(file, design(false))
  const lines = []
  const c = workerCompiler({ root, configFile: join(root, 'pcb.config.ts'), log: l => lines.push(l) })
  const [b] = await c.compile({ file, rel: 'pcb.tsx' }, { draft: false })
  assert.equal(b.board.name, 'Crash')
  assert.ok(existsSync(mark), 'the first thread crashed')
  assert.match(lines.join('\n'), /exited with code 7; restarting it and compiling again/)
  c.draft(file, { code: design(true), limit: null })
  await assert.rejects(c.compile({ file, rel: 'pcb.tsx' }, { draft: true }), /exited with code 7 twice in a row/)
  // this process lives on, and the next compile gets a new thread
  c.draft(file, null)
  rmSync(mark)
  const [again] = await c.compile({ file, rel: 'pcb.tsx' }, { draft: false })
  assert.equal(again.board.name, 'Crash')
  await c.close()
})

/** A project with its own default rules, KiCad library and font; `own` picks the variant. */
function isolated(dir, own) {
  mkdirSync(join(dir, 'parts', 'Mine.pretty'), { recursive: true })
  writeFileSync(
    join(dir, 'pcb.config.ts'),
    `import { defineConfig, defineDefaultBoard } from '@pcbjs/core'
defineDefaultBoard({ rev: '${own.rev}', rules: { clearance: ${own.clearance} } })
export default defineConfig({ entries: ['pcb.tsx'], kicad: { footprints: ['parts'] } })
`,
  )
  writeFileSync(
    join(dir, 'parts', 'Mine.pretty', 'Pad.kicad_mod'),
    `(footprint "Pad" (version 20240108) (attr smd)\n  (pad "1" smd rect (at 0 0) (size ${own.pad} ${own.pad}) (layers "F.Cu" "F.Paste" "F.Mask")))\n`,
  )
  if (own.font) cpSync(FONT, join(dir, 'font.ttf'))
  writeFileSync(
    join(dir, 'pcb.tsx'),
    `import PCB, { nets } from '@pcbjs/core'
import { kicadFootprint } from '@pcbjs/kicad'
const Pad = kicadFootprint('Mine:Pad')
const { A, B } = nets()
const P1 = Pad().connect({ 1: A })
const P2 = Pad().connect({ 1: B })
export default (
  <PCB name="${own.name}"${own.font ? " fonts={{ slab: { file: './font.ttf' } }}" : ''}>
    <rect layer="Edge.Cuts" x={0} y={0} w={20} h={10} />
    <P1 at="8 5" />
    <P2 at="10.6 5" />
    <text layer="F.SilkS" at="10 8.5" size={1}${own.font ? ' font="slab"' : ' font="newstroke"'}>${own.name}</text>
  </PCB>
)
`,
  )
}

const both = (cwd, ...args) => {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8' })
  return { out: r.stdout, err: r.stderr }
}
const run = (cwd, ...args) => both(cwd, ...args).out
// a board line's time, and the phases a slow compile adds to it
const noMs = s => s.replace(/\d+(\.\d+)? (ms|s)\b/g, 'T').replace(/T: [a-z]+ T(, [a-z]+ T)*/g, 'T')

test('two projects with their own defaults, KiCad libraries and fonts, compiled alternately in one session, match in process', { timeout: 240000 }, async () => {
  const top = tmp('pcbjs-two-')
  linkPackages(top)
  const a = join(top, 'a'),
    b = join(top, 'b')
  isolated(a, { name: 'Alpha', rev: 'A', clearance: 0.2, pad: 1.5, font: true })
  isolated(b, { name: 'Beta', rev: 'B', clearance: 0.9, pad: 2.5, font: false })
  const child = spawn(process.execPath, [BIN, 'session', 'serve', '--workspace', top, '--port', '0', '--host', '127.0.0.1'], { cwd: top, stdio: ['ignore', 'pipe', 'pipe'] })
  children.push(child)
  let out = ''
  child.stdout.on('data', d => (out += d))
  child.stderr.on('data', d => (out += d))
  try {
    const t0 = Date.now()
    while (!existsSync(join(b, '.pcbjs', 'dev.json'))) {
      if (Date.now() - t0 > 30000) throw new Error(`no session:\n${out}`)
      await new Promise(r => setTimeout(r, 50))
    }
    const info = JSON.parse(readFileSync(join(top, '.pcbjs', 'dev.json'), 'utf8'))
    const conn = await connectSession(info.socket, { name: 'test', role: 'agent' })
    for (const [round, dir] of [a, b, a, b].entries()) {
      // an edit each round, so every round compiles again
      writeFileSync(join(dir, 'pcb.tsx'), readFileSync(join(dir, 'pcb.tsx'), 'utf8').replace(/<P2 at="[\d.]+ 5"/, `<P2 at="${10.6 + round * 0.1} 5"`))
      const r = await conn.request('session/check', { project: dir }, 120000)
      assert.equal(noMs(r.value.stdout), noMs(run(dir, 'check', '--fresh')), `check of ${dir}, round ${round}`)
      for (const q of [[], ['P1'], ['P2'], ['--layer', 'F.SilkS']]) {
        const via = both(dir, 'inspect', ...q)
        assert.match(via.err, /^session \w+  snapshot /, 'the session answered')
        assert.equal(via.out, run(dir, 'inspect', '--fresh', ...q), `inspect ${q.join(' ')} of ${dir}, round ${round}`)
      }
    }
    // the defaults really differ: the narrow gap is a clearance error in Beta only
    assert.doesNotMatch(run(a, 'check'), /clearance/)
    assert.match(run(b, 'check'), /DRC clearance/)
    conn.close()
  } finally {
    await stop(child)
  }
})

test('an obsolete queued sketch rejects before loading its entry and the latest sketch still draws', { timeout: 30000 }, async () => {
  const root = tmp('pcbjs-sketch-queue-')
  linkPackages(root)
  writeFileSync(join(root, 'pcb.config.ts'), "import { defineConfig } from '@pcbjs/core'\nexport default defineConfig({ entries: ['pcb.tsx'] })\n")
  const file = join(root, 'pcb.tsx')
  const code = `import PCB from '@pcbjs/core'
export default <PCB name="Latest"><rect layer="Edge.Cuts" x={0} y={0} w={10} h={10}/><text layer="F.SilkS" at="5 5">latest</text></PCB>`
  writeFileSync(file, code)
  const c = workerCompiler({ root, configFile: join(root, 'pcb.config.ts'), log() {} })
  try {
    const old = join(root, 'obsolete.tsx')
    const obsolete = code.replace('Latest', 'Obsolete').replace('latest', 'obsolete')
    writeFileSync(old, obsolete)
    const stale = c.sketch({ file: old, rel: 'obsolete.tsx' }, { file: old, code: obsolete, spans: [[1, 3]], base: 1 })
    c.cancelSketch()
    await assert.rejects(stale, e => e.name === 'CancelledError')
    assert.equal(c.graph().getModulesByFile(old), undefined, 'cancelled entry never enters the loader graph')
    const latest = await c.sketch({ file, rel: 'pcb.tsx' }, { file, code, spans: [[1, 3]], base: 1 })
    assert.equal(latest.board, 'Latest')
    assert.ok(latest.data.items.some(it => it.kind === 'text'))
  } finally {
    await c.close()
  }
})

test('a cached interactive board prepares its source graph before accepting the first edit', { timeout: 30000 }, async () => {
  const root = tmp('pcbjs-sketch-ready-')
  linkPackages(root)
  writeFileSync(join(root, 'pcb.config.ts'), "import { defineConfig } from '@pcbjs/core'\nexport default defineConfig({ entries: ['pcb.tsx'] })\n")
  const file = join(root, 'pcb.tsx')
  const code = `import PCB from '@pcbjs/core'
if (process.env.PCBJS_TEST_EDITABLE_FAIL === '1') throw new Error('editable source preparation failed')
export default <PCB name="Prepared"><rect layer="Edge.Cuts" x={0} y={0} w={10} h={10}/><text layer="F.SilkS" at="5 5">before</text></PCB>`
  writeFileSync(file, code)
  const entry = { file, rel: 'pcb.tsx' }
  const options = { root, configFile: join(root, 'pcb.config.ts'), log() {} }
  const seed = workerCompiler(options)
  try {
    await seed.compile(entry, { draft: false })
  } finally {
    await seed.close()
  }
  const interactive = workerCompiler(options)
  try {
    const [cached] = await interactive.compile(entry, { draft: false })
    assert.ok(
      cached.stages.some(s => s.hit),
      'the ready board reuses its saved stage cache',
    )
    assert.ok(interactive.graph().getModulesByFile(file)?.length, 'editable readiness includes the source evaluation lane')
    const latest = await interactive.sketch(entry, { file, code: code.replace('before', 'after'), spans: [[1, 4]], base: 1 })
    assert.equal(latest.board, 'Prepared')
    assert.ok(latest.data.items.some(it => it.kind === 'text'))
  } finally {
    await interactive.close()
  }
  const before = process.env.PCBJS_TEST_EDITABLE_FAIL
  process.env.PCBJS_TEST_EDITABLE_FAIL = '1'
  const failed = workerCompiler(options)
  try {
    await assert.rejects(failed.compile(entry, { draft: false }), /editable source preparation failed/)
  } finally {
    await failed.close()
    if (before === undefined) delete process.env.PCBJS_TEST_EDITABLE_FAIL
    else process.env.PCBJS_TEST_EDITABLE_FAIL = before
  }
})
