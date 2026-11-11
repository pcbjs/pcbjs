// Session workers discard stale source work, recover after crashes and accept current live sketches.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { workerCompiler } from '../dist/session/worker-client.js'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

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
  let routing = () => {}
  const started = new Promise(r => (routing = r))
  const job = c.compile(entry, { draft: true, progress: p => p.legs && routing() })
  await started
  // the router is past its first leg: the edit cancels it there
  c.cancel()
  await assert.rejects(job, e => e.name === 'CancelledError')
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

test('a cancel at final exports rejects the result while preserving the next transport baseline', { timeout: 30000 }, async () => {
  const root = tmp('pcbjs-late-cancel-')
  linkPackages(root)
  writeFileSync(join(root, 'pcb.config.ts'), "import { defineConfig } from '@pcbjs/core'\nexport default defineConfig({ entries: ['pcb.tsx'] })\n")
  const file = join(root, 'pcb.tsx')
  writeFileSync(file, 'import PCB from \'@pcbjs/core\'\nexport default <PCB name="Late"><rect layer="Edge.Cuts" x={0} y={0} w={10} h={10}/></PCB>')
  const c = workerCompiler({ root, configFile: join(root, 'pcb.config.ts'), log() {} })
  const entry = { file, rel: 'pcb.tsx' }
  try {
    // Warm the source loader so final exports are followed only by transport work.
    await c.compile(entry, { draft: true })
    c.draft(file, { code: readFileSync(file, 'utf8').replace('name="Late"', 'name="Current"'), limit: null })
    let cancelled = false
    await assert.rejects(
      c.compile(entry, {
        draft: true,
        stage: s => {
          if (s.name === 'exports' && s.state === 'done') {
            cancelled = true
            c.cancel()
          }
        },
      }),
      e => e.name === 'CancelledError',
    )
    assert.equal(cancelled, true)
    const [next] = await c.compile(entry, { draft: true })
    assert.equal(next.board.name, 'Current')
    assert.equal(next.site.name, 'Current')
  } finally {
    await c.close()
  }
})
