// `pcbjs patch hold`: the route frozen into pcb.patches.ts beside the entry, read back with the same copper, replaced in place, and stale once an end moves.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withPatch } from '@pcbjs/cli/internal/patch'

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BIN = join(PKG, 'bin', 'pcbjs.js')

const cli = (cwd, ...args) =>
  new Promise(done => {
    execFile(process.execPath, [BIN, ...args], { cwd, env: { ...process.env, NODE_ENV: 'production' }, timeout: 120000 }, (err, stdout, stderr) => {
      done({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr })
    })
  })

const board = (r2 = '25 15', block = true) => `import PCB, { nets, route, defineFootprint, h } from '@pcbjs/core'
const { A, B } = nets()
const One = defineFootprint(p => h('footprint', p, h('pad', { num: 1, size: 1, type: 'smd' })), { pins: ['1'] as const, prefix: 'J' })
const Big = defineFootprint(p => h('footprint', p, h('pad', { num: 1, size: 4, type: 'smd' })), { pins: ['1'] as const, prefix: 'X' })
const J1 = One().connect({ 1: A })
const J2 = One().connect({ 1: A })
${block ? 'const X1 = Big().connect({ 1: B })' : '// X1 removed'}
export default (
  <PCB name="Held">
    <rect layer="Edge.Cuts" x={0} y={0} w={30} h={20} />
    <J1 at="5 5" />
    <J2 at="${r2}" />
    ${block ? '<X1 at="15 10" />' : ''}
    {route(J1[1], J2[1]).width(0.25)}
  </PCB>
)
`

let root
before(() => {
  root = mkdtempSync(join(tmpdir(), 'pcbjs-patch-cli-'))
  mkdirSync(join(root, 'node_modules'))
  symlinkSync(resolve(PKG, '..', '..', 'node_modules', '@pcbjs'), join(root, 'node_modules', '@pcbjs'), 'dir')
  writeFileSync(join(root, 'pcb.config.ts'), "import { defineConfig } from '@pcbjs/core'\nexport default defineConfig({ entries: ['pcb.tsx'] })\n")
  writeFileSync(join(root, 'pcb.tsx'), board())
})
after(() => rmSync(root, { recursive: true, force: true }))

const lengths = async () => {
  const r = await cli(root, 'inspect', '--lengths')
  assert.equal(r.code, 0, r.stdout + r.stderr)
  return r.stdout
}

test('patch hold: written, read back with the same copper, replaced in place, stale once an end moves', { timeout: 300000 }, async () => {
  const before = await lengths()
  const w = await cli(root, 'patch', 'hold', 'route:1')
  assert.equal(w.code, 0, w.stdout + w.stderr)
  assert.match(w.stdout, /^created pcb\.patches\.ts: hold of route:1, \d+ tracks?, hash [0-9a-f]{12}$/m)
  const text = readFileSync(join(root, 'pcb.patches.ts'), 'utf8')
  assert.match(
    text,
    /^import \{ patch \} from '@pcbjs\/core'\n\nexport default \[\n {2}patch\(\n {4}'route:1',\n {4}\{\n {6}hold: \{\n {8}snapshot: '[0-9a-f]{16}',\n {8}tracks: \[/,
  )
  // the obstacle gone: the held route keeps the copper it routed around it with
  writeFileSync(join(root, 'pcb.tsx'), board('25 15', false))
  const c = await cli(root, 'check')
  assert.equal(c.code, 0, c.stdout + c.stderr)
  assert.match(c.stdout, /routing 1 leg, 0 routed, 0 failed, 0 cached, 1 held|routing 1 leg, 1 routed, 0 failed, \d cached, 1 held/)
  assert.doesNotMatch(c.stdout, /patch-stale/)
  assert.equal(await lengths(), before)
  // a second hold of the same route replaces the first
  const again = await cli(root, 'patch', 'hold', 'route:1')
  assert.equal(again.code, 0, again.stdout + again.stderr)
  assert.match(again.stdout, /^wrote pcb\.patches\.ts/m)
  assert.equal(readFileSync(join(root, 'pcb.patches.ts'), 'utf8').match(/patch\(/g).length, 1)
  // an end moved: the hold is skipped with a warning naming its file
  writeFileSync(join(root, 'pcb.tsx'), board('25 14', false))
  const moved = await cli(root, 'check')
  assert.match(
    moved.stdout,
    /warning\s+patch-stale  at \(5\.00, 5\.00\)  route:1  pcb\.patches\.ts:4:3: the hold patch of route:1 is skipped: its target hashes [0-9a-f]{12}, the patch names [0-9a-f]{12}, from snapshot [0-9a-f]{16}/,
  )
  assert.match(moved.stdout, /0 held/)
  await cli(root, 'check', '--json', 'report.json')
  const [f] = JSON.parse(readFileSync(join(root, 'report.json'), 'utf8')).boards[0].findings.filter(f => f.rule === 'patch-stale')
  assert.deepEqual(f.src, [{ file: 'pcb.patches.ts', start: [4, 3], end: [4, 3], role: 'patch' }])
  assert.equal(f.args.snapshot.length, 16)
})

test('withPatch: appended after the last entry, with or without its trailing comma', () => {
  const p = { ref: 'R1', hash: 'abcdef012345', op: { width: 0.3 } }
  assert.equal(
    withPatch("export default [\n  patch('R2', { width: 1 }, 'abcdef012345')\n]\n", p),
    "export default [\n  patch('R2', { width: 1 }, 'abcdef012345'),\n  patch('R1', { width: 0.3 }, 'abcdef012345'),\n]\n",
  )
  assert.equal(withPatch('export default []\n', p), "export default [\n  patch('R1', { width: 0.3 }, 'abcdef012345'),\n]\n")
  assert.throws(() => withPatch('export const x = 1\n', p), /must export default a list/)
})
