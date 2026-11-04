import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs, { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, install, installLine, skillNames, skillsDir } from '../index.mjs'

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const root = pkg
const names = readdirSync(root).filter(n => existsSync(join(root, n, 'SKILL.md')))
const run = (cwd, opts) =>
  install(cwd, opts)
    .map(s => installLine(s, cwd))
    .join('\n')
    .replaceAll('\\', '/')

test('skills: the five skills, each with valid frontmatter, a short body and only references that exist', () => {
  assert.deepEqual(names.sort(), ['pcbjs-basics', 'pcbjs-best-practices', 'pcbjs-port-from-kicad', 'pcbjs-port-from-python-scripted', 'pcbjs-upgrade'])
  for (const name of names) {
    const text = readFileSync(join(root, name, 'SKILL.md'), 'utf8')
    const head = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1]
    assert.ok(head, `${name}: no frontmatter`)
    assert.equal(/^name: (.*)$/m.exec(head)?.[1], name)
    const description = /^description: (.*)$/m.exec(head)?.[1] ?? ''
    assert.ok(description.length > 50 && description.length <= 1024, `${name}: description of ${description.length} characters`)
    assert.ok(text.split('\n').length < 500, `${name}: SKILL.md over 500 lines`)
    for (const [, ref] of text.matchAll(/\b(references\/[\w.-]+\.md)/g)) assert.ok(existsSync(join(root, name, ref)), `${name}: ${ref} is missing`)
  }
})

test('skills: package.json ships every skill folder and nothing else is taken for one', () => {
  const { files } = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8'))
  for (const name of names) assert.ok(files.includes(name), `${name} is not in files`)
  assert.deepEqual(skillNames(), [...names].sort())
})

test('skills: no em-dash and no path to an untracked note', () => {
  for (const name of names)
    for (const file of readdirSync(join(root, name), { recursive: true }).filter(f => f.endsWith('.md'))) {
      const text = readFileSync(join(root, name, file), 'utf8')
      assert.ok(!text.includes('—'), `${name}/${file}: em-dash`)
      assert.ok(!/\b(CLAUDE|REVIEW|PORT|IMPROVEMENTS)\.md\b/.test(text), `${name}/${file}: names an untracked note`)
    }
})

const tmp = () => mkdtempSync(join(tmpdir(), 'pcbjs-skills-'))
const target = (from, name) => join(from, 'node_modules', '@pcbjs', 'skills', name)
const installHere = dir => {
  mkdirSync(join(dir, 'node_modules', '@pcbjs'), { recursive: true })
  symlinkSync(pkg, join(dir, 'node_modules', '@pcbjs', 'skills'))
}
const project = () => {
  const dir = tmp()
  installHere(dir)
  return dir
}

test("install: links .agents/skills and .claude/skills into the project's node_modules", () => {
  const dir = project()
  try {
    const first = run(dir)
    for (const name of names)
      for (const d of ['.agents', '.claude']) {
        const link = join(dir, d, 'skills', name)
        assert.ok(lstatSync(link).isSymbolicLink(), link)
        assert.equal(readlinkSync(link), target(join('..', '..'), name))
        assert.ok(existsSync(join(link, 'SKILL.md')), link)
      }
    assert.match(first, /^installed  pcbjs-basics  link .agents\/skills\/pcbjs-basics  link .claude\/skills\/pcbjs-basics$/m)
    assert.equal(first.split('\n').length, names.length)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('install: outside a project it copies into .agents/skills and links .claude/skills to the copy', () => {
  const dir = tmp()
  try {
    const out = run(dir)
    const copy = join(dir, '.agents', 'skills', 'pcbjs-basics')
    assert.ok(lstatSync(copy).isDirectory() && existsSync(join(copy, 'SKILL.md')))
    assert.equal(readlinkSync(join(dir, '.claude', 'skills', 'pcbjs-basics')), join('..', '..', '.agents', 'skills', 'pcbjs-basics'))
    assert.match(out, /^installed  pcbjs-basics  copy .agents\/skills\/pcbjs-basics  link .claude\/skills\/pcbjs-basics$/m)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('install: re-running replaces a copy, a folder or a stale link by a link, and leaves other folders alone', () => {
  const dir = tmp()
  try {
    run(dir)
    installHere(dir)
    const claude = join(dir, '.claude', 'skills')
    rmSync(join(claude, 'pcbjs-upgrade'))
    mkdirSync(join(claude, 'pcbjs-upgrade'))
    writeFileSync(join(claude, 'pcbjs-upgrade', 'stale.md'), 'old')
    rmSync(join(claude, 'pcbjs-basics'))
    mkdirSync(join(dir, 'elsewhere'))
    writeFileSync(join(dir, 'elsewhere', 'keep.md'), 'mine')
    symlinkSync(join('..', '..', 'elsewhere'), join(claude, 'pcbjs-basics'))
    mkdirSync(join(claude, 'mine'))
    const again = run(dir)
    assert.match(again, /^updated    pcbjs-basics  link .agents\/skills\/pcbjs-basics  link .claude\/skills\/pcbjs-basics$/m)
    for (const name of names) for (const d of ['.agents', '.claude']) assert.equal(readlinkSync(join(dir, d, 'skills', name)), target(join('..', '..'), name))
    assert.ok(existsSync(join(claude, 'mine')) && existsSync(join(dir, 'elsewhere', 'keep.md')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('install: to installs into that folder alone, claude: false skips the companion', () => {
  const dir = project()
  try {
    const to = run(dir, { to: 'agents' })
    assert.equal(readlinkSync(join(dir, 'agents', 'pcbjs-upgrade')), target('..', 'pcbjs-upgrade'))
    assert.ok(existsSync(join(dir, 'agents', 'pcbjs-upgrade', 'SKILL.md')))
    assert.match(to, /^installed  pcbjs-basics  link agents\/pcbjs-basics$/m)
    assert.ok(!existsSync(join(dir, '.claude')) && !existsSync(join(dir, '.agents')))
    const bare = run(dir, { claude: false })
    assert.ok(existsSync(join(dir, '.agents', 'skills', 'pcbjs-basics', 'SKILL.md')))
    assert.ok(!existsSync(join(dir, '.claude')))
    assert.match(bare, /^installed  pcbjs-basics  link .agents\/skills\/pcbjs-basics$/m)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('install: copies where a symlink cannot be made, and leaves a shared .claude/skills alone', () => {
  const dir = project()
  const symlink = fs.symlinkSync
  try {
    fs.symlinkSync = () => {
      throw Object.assign(new Error('EPERM'), { code: 'EPERM' })
    }
    const done = install(dir)
    assert.deepEqual(
      done.map(s => [s.kind, s.companion.kind]),
      names.map(() => ['copy', 'copy']),
    )
    for (const d of ['.agents', '.claude']) assert.ok(lstatSync(join(dir, d, 'skills', 'pcbjs-basics')).isDirectory())
    assert.equal(installLine(done[0], dir).replaceAll('\\', '/'), 'installed  pcbjs-basics  copy .agents/skills/pcbjs-basics  copy .claude/skills/pcbjs-basics')
  } finally {
    fs.symlinkSync = symlink
    rmSync(dir, { recursive: true, force: true })
  }
  const shared = project()
  try {
    mkdirSync(join(shared, '.agents', 'skills'), { recursive: true })
    mkdirSync(join(shared, '.claude'))
    symlinkSync(join('..', '.agents', 'skills'), join(shared, '.claude', 'skills'))
    const done = install(shared)
    assert.deepEqual(
      done.map(s => s.companion.kind),
      names.map(() => 'shared'),
    )
    assert.ok(existsSync(join(shared, '.agents', 'skills', 'pcbjs-basics', 'SKILL.md')))
  } finally {
    rmSync(shared, { recursive: true, force: true })
  }
  assert.throws(() => install(pkg, { to: '.' }), /own folder/)
})

test('skills: describe, skillsDir and no bin', () => {
  assert.match(`${skillNames()[0]}  ${describe(skillNames()[0])}`, /^pcbjs-basics {2}Design a PCB in pcbjs/)
  assert.equal(skillsDir, root)
  const { bin, files } = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8'))
  assert.equal(bin, undefined)
  assert.ok(!files.includes('bin') && !existsSync(join(pkg, 'bin')))
})
