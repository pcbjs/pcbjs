// pcbjs create: copies the board template, names the board after the directory, refuses a directory with files in it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { create, boardName, templates } from '../dist/create.js'

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
