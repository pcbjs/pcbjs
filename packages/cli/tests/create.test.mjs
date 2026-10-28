// pcbjs create: copies the board template or an example, names the board after the directory, refuses a directory with files in it, shapes the board from its flags.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { create, boardName, templates, examples, EXAMPLES_DIR } from '../dist/create.js'
import { parseBoard } from '../dist/board-flags.js'
import { drift, EXAMPLES } from '../scripts/sync-examples.mjs'

const BIN = new URL('../../pcbjs/bin/pcbjs.js', import.meta.url).pathname

const scratch = () => mkdtempSync(join(tmpdir(), 'pcbjs-create-'))

test('create: the board template is listed', () => {
  assert.ok(templates().includes('board'))
})

test('create: copies the template and names the board after the directory', () => {
  const cwd = scratch(),
    lines = []
  try {
    const r = create({ dir: 'blinky-mini', cwd, log: l => lines.push(l) })
    assert.equal(r.name, 'blinky-mini')
    assert.deepEqual(readdirSync(r.dir).sort(), ['.gitignore', 'README.md', 'package.json', 'pcb.config.ts', 'pcb.tsx', 'tsconfig.json'])
    const main = readFileSync(join(r.dir, 'pcb.tsx'), 'utf8')
    assert.match(main, /<PCB name="blinky-mini" revision="0\.1\.0">/)
    assert.match(main, />\s*blinky-mini\s*<\/text>/)
    assert.doesNotMatch(main, /\bHello\b/)
    assert.match(readFileSync(join(r.dir, 'README.md'), 'utf8'), /^# blinky-mini\n/)
    const pkg = JSON.parse(readFileSync(join(r.dir, 'package.json'), 'utf8'))
    assert.equal(pkg.name, 'blinky-mini')
    assert.deepEqual(Object.keys(pkg.scripts), ['dev', 'build', 'preview'])
    assert.deepEqual(Object.values(pkg.scripts), ['pcbjs dev', 'pcbjs build', 'pcbjs preview'], 'the entries come from the config')
    assert.match(readFileSync(join(r.dir, 'pcb.config.ts'), 'utf8'), /^  entries: \['pcb\.tsx'\],/m)
    assert.match(pkg.devDependencies['@pcbjs/pcbjs'], /^(~\d+\.\d+\.0|[a-z]+)$/)
    assert.match(readFileSync(join(r.dir, '.gitignore'), 'utf8'), /^\.pcbjs$/m)
    assert.ok(lines.some(l => l.includes('cd blinky-mini')))
    assert.ok(lines.some(l => l.includes('npm run dev')))
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('create: an empty directory is fine, a package name is lowercase', () => {
  const cwd = scratch()
  try {
    mkdirSync(join(cwd, 'My Board'))
    const r = create({ dir: 'My Board', cwd, log: () => {} })
    assert.equal(r.name, 'My-Board')
    assert.equal(JSON.parse(readFileSync(join(r.dir, 'package.json'), 'utf8')).name, 'my-board')
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('create: refuses a directory that is not empty, and an unknown template', () => {
  const cwd = scratch()
  try {
    mkdirSync(join(cwd, 'taken'))
    writeFileSync(join(cwd, 'taken', 'notes.txt'), 'mine')
    assert.throws(() => create({ dir: 'taken', cwd, log: () => {} }), /taken is not empty/)
    assert.deepEqual(readdirSync(join(cwd, 'taken')), ['notes.txt'])
    assert.throws(() => create({ dir: 'x', cwd, template: 'nope', log: () => {} }), /unknown template "nope", available: board/)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('create: board names keep letters, digits, dot, dash and underscore', () => {
  assert.equal(boardName('/a/b/led_v2.1'), 'led_v2.1')
  assert.equal(boardName('/a/b/<odd> "name"'), 'odd-name')
  assert.equal(boardName('/a/b/---'), 'board')
})

test('create: the examples in templates match examples/, run scripts/sync-examples.mjs after changing one', () => {
  assert.deepEqual(drift(), [])
  assert.deepEqual(Object.keys(examples()), Object.keys(EXAMPLES))
  assert.ok(!templates().includes('examples'))
})

test('create --list-examples prints each example with its line', () => {
  const out = execFileSync(process.execPath, [BIN, 'create', '--list-examples'], { encoding: 'utf8' })
  const names = out
    .trim()
    .split('\n')
    .map(l => l.split(/\s{2,}/))
  assert.deepEqual(
    names.map(([n]) => n),
    ['blinky', 'coin', 'quad', 'multi', 'led-matrix', 'qfn-breakout'],
  )
  assert.ok(names.every(([, d]) => d && d.length > 20))
})

test('create --example copies the example as it is, a single board in pcb.tsx', () => {
  const cwd = scratch()
  try {
    const out = execFileSync(process.execPath, [BIN, 'create', 'mine', '--example', 'blinky'], { cwd, encoding: 'utf8' })
    assert.match(out, /created mine from the blinky example/)
    const dir = join(cwd, 'mine')
    assert.deepEqual(readdirSync(dir).sort(), ['.gitignore', 'blinky.sch.tsx', 'blinky.sourcing.ts', 'lib', 'package.json', 'pcb.config.ts', 'pcb.tsx', 'tsconfig.json'])
    assert.equal(readFileSync(join(dir, 'pcb.tsx'), 'utf8'), readFileSync(join(EXAMPLES_DIR, 'blinky', 'pcb.tsx'), 'utf8'))
    assert.match(readFileSync(join(dir, 'pcb.config.ts'), 'utf8'), /entries: \['pcb\.tsx'\]/)
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    assert.equal(pkg.name, 'mine')
    assert.match(pkg.devDependencies['@pcbjs/core'], /^(~\d+\.\d+\.0|[a-z]+)$/)
    assert.throws(() => create({ dir: 'x', cwd, example: 'nope', log: () => {} }), /unknown example "nope", available: blinky, coin/)
    assert.throws(() => create({ dir: 'y', cwd, example: 'coin', layers: 4, log: () => {} }), /--example takes no/)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('create: no flags keep the template, the flags pick the fab and draw the outline around the centred circuit', () => {
  const cwd = scratch()
  try {
    const plain = create({ dir: 'Hello', cwd, log: () => {} })
    assert.equal(readFileSync(join(plain.dir, 'pcb.tsx'), 'utf8'), readFileSync(new URL('../templates/board/pcb.tsx', import.meta.url), 'utf8'))
    const wiz = create({ dir: 'wiz', cwd, layers: 4, size: '50x40', outline: 'rounded:2', log: () => {} })
    const main = readFileSync(join(wiz.dir, 'pcb.tsx'), 'utf8')
    assert.match(main, /^\/\/ wiz: a green LED on a 50 x 40 mm four-layer board/)
    assert.match(main, /import PCB from '@pcbjs\/fab\/JLCPCB\/4-Layer'/)
    assert.match(main, /d=\{roundedRect\(50, 40, 2\)\}/)
    assert.match(main, /<J1 at="18 17\.46" \/>/)
    const round = create({ dir: 'round', cwd, fab: 'OSHPark/2-Layer', outline: 'circle', log: () => {} })
    const r = readFileSync(join(round.dir, 'pcb.tsx'), 'utf8')
    assert.match(r, /d=\{circle\(40, 20, 20\)\}/)
    assert.match(r, /import \{ PinHeader, R0603, LED0603, circle \} from '@pcbjs\/lib'/)
    assert.match(r, /40 mm round two-layer board/)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('create flags: defaults, layer and fab agreement, sizes the parts fit', () => {
  assert.deepEqual(parseBoard({}), { fab: 'JLCPCB/2-Layer', layers: 2, w: 20, h: 15, outline: { kind: 'rounded', r: 1 } })
  assert.equal(parseBoard({ layers: 6 }).fab, 'JLCPCB/6-Layer')
  assert.equal(parseBoard({ fab: '@pcbjs/fab/PCBWay/4-Layer' }).layers, 4)
  assert.deepEqual(parseBoard({ size: '50 x 40', outline: 'rect' }), { fab: 'JLCPCB/2-Layer', layers: 2, w: 50, h: 40, outline: { kind: 'rect' } })
  assert.throws(() => parseBoard({ layers: 3 }), /--layers takes 2, 4, 6, 8/)
  assert.throws(() => parseBoard({ fab: 'Nope/2-Layer' }), /--fab takes one of JLCPCB\/2-Layer/)
  assert.throws(() => parseBoard({ layers: 2, fab: 'JLCPCB/4-Layer' }), /has 4 layers, not 2/)
  assert.throws(() => parseBoard({ size: '10x10' }), /at least 20 x 15/)
  assert.throws(() => parseBoard({ size: '40x30', outline: 'circle' }), /one diameter/)
  assert.throws(() => parseBoard({ outline: 'oval' }), /--outline takes/)
})
