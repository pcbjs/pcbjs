// Board references through the cli, see docs/references.md: the referenced entry compiles in a child process, its result is
// kept per content hash of its module graph, a cycle is an error naming it, and the workspace server marks a scope stale when
// a board it references changes.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { referenceResolver, referenceStats, boardMeshDir } from '../dist/references.js'
import { devWorkspace } from '../dist/workspace.js'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const roots = []
after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

const board = (name, title, extra = '', kids = '') => `import PCB, { reference } from '@pcbjs/core'
import { PinHeader } from '@pcbjs/lib'
${extra}
const J1 = PinHeader(2)
export default (
  <PCB name="${name}" title="${title}">
    <rect layer="Edge.Cuts" x={0} y={0} w={20} h={20} />
    <J1 at="5 5" />
    ${kids}
  </PCB>
)
`
function stack() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pcbjs-ref-')))
  roots.push(root)
  mkdirSync(join(root, 'node_modules'))
  symlinkSync(join(REPO, 'node_modules', '@pcbjs'), join(root, 'node_modules', '@pcbjs'), 'dir')
  const dirs = {}
  for (const n of ['a', 'b']) {
    const d = join(root, 'stack', n)
    mkdirSync(d, { recursive: true })
    writeFileSync(join(d, 'pcb.config.ts'), "import { defineConfig } from '@pcbjs/core'\nexport default defineConfig({ entries: ['pcb.tsx'], vite: { logLevel: 'silent' } })\n")
    dirs[n] = d
  }
  writeFileSync(join(dirs.a, 'pcb.tsx'), board('A', 'Alpha', '', "{reference('../b/pcb.tsx', { at: [0, 0, 10] })}"))
  writeFileSync(join(dirs.b, 'pcb.tsx'), board('B', 'Beta 1'))
  return { root, stack: join(root, 'stack'), a: dirs.a, b: dirs.b }
}
const memo = () => globalThis[Symbol.for('pcbjs.cli.references')]

test('references: a referenced entry compiles once per content of its graph, from the cache after that', () => {
  const s = stack()
  const r = referenceResolver(s.a, join(s.a, 'pcb.tsx'))
  const st = referenceStats(),
    spawned = st.spawned
  const one = r.resolve(join(s.b, 'pcb.tsx'))
  assert.equal(st.spawned, spawned + 1)
  assert.equal(one.name, 'B')
  assert.equal(one.title, 'Beta 1')
  assert.ok(one.files.includes(join(s.b, 'pcb.tsx')) && one.files.includes(join(s.b, 'pcb.config.ts')), one.files.join(' '))
  assert.ok(existsSync(join(boardMeshDir(s.a), `${one.mesh}.bin`)), 'the mesh is in the cache')
  assert.deepEqual(
    one.footprints.map(f => f.ref),
    ['J1'],
  )
  // the same process, then a new one with only the cache file: neither compiles again
  assert.equal(r.resolve(join(s.b, 'pcb.tsx')).hash, one.hash)
  memo().clear()
  assert.equal(r.resolve(join(s.b, 'pcb.tsx')).hash, one.hash)
  assert.equal(st.spawned, spawned + 1)
  // an edit of its graph compiles it again
  writeFileSync(join(s.b, 'pcb.tsx'), board('B', 'Beta 2'))
  const two = r.resolve(join(s.b, 'pcb.tsx'))
  assert.equal(st.spawned, spawned + 2)
  assert.equal(two.title, 'Beta 2')
  assert.notEqual(two.hash, one.hash)
})

test('references: a cycle across entries is an error naming it, found in the child that closes it', () => {
  const s = stack()
  writeFileSync(join(s.b, 'pcb.tsx'), board('B', 'Beta', '', "{reference('../a/pcb.tsx', { at: [0, 0, -10] })}"))
  const r = referenceResolver(s.a, join(s.a, 'pcb.tsx'))
  assert.throws(() => r.resolve(join(s.b, 'pcb.tsx')), /a reference cycle: a → b → a/)
  // an entry referencing itself
  assert.throws(() => r.resolve(join(s.a, 'pcb.tsx')), /a reference cycle: a → a/)
})

test('references: the workspace server marks a scope stale when a board it references changes, and recompiles it when shown', async () => {
  const s = stack()
  const log = console.log
  console.log = () => {}
  let server, workspace
  try {
    ;({ server, workspace } = await devWorkspace({ folders: [s.stack], port: 0, host: '127.0.0.1' }))
  } finally {
    console.log = log
  }
  server.config.logger.info = () => {}
  try {
    const base = `http://127.0.0.1:${server.httpServer.address().port}`
    const scope = slug => workspace.scopes.find(x => x.slug === slug)
    const refTitle = () => scope('a').state?.slots[0].compiled?.[0].board.references?.[0].title
    const until = async (fn, what) => {
      for (let i = 0; i < 600 && !fn(); i++) await new Promise(r => setTimeout(r, 25))
      assert.ok(fn(), what)
    }
    await fetch(`${base}/__pcbjs/scope/a`)
    assert.equal(refTitle(), 'Beta 1')
    assert.ok(scope('a').files.includes(join(s.b, 'pcb.tsx')), "the referenced entry is in the scope's files")
    await fetch(`${base}/__pcbjs/scope/b`)
    await new Promise(r => setTimeout(r, 50))
    writeFileSync(join(s.b, 'pcb.tsx'), board('B', 'Beta 2'))
    await until(() => scope('a').stale, 'the scope that references the edited board is stale')
    await fetch(`${base}/__pcbjs/scope/a`)
    await until(() => refTitle() === 'Beta 2', 'shown again, it recompiles with the new reference')
    assert.equal(scope('a').stale, false)
  } finally {
    await server.close()
  }
})
