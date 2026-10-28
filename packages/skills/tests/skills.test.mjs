import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs, { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrations, render } from '../scripts/sync-changelog.mjs'
import { install, installLine, skillNames } from '../index.mjs'

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const root = pkg
const bin = join(pkg, 'bin', 'pcbjs-skills.mjs')
const names = readdirSync(root).filter(n => existsSync(join(root, n, 'SKILL.md')))
const run = (args, cwd) => spawnSync(process.execPath, [bin, ...args], { cwd, encoding: 'utf8' })

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

test("pcbjs-skills: install links .agents/skills and .claude/skills into the project's node_modules", () => {
  const dir = project()
  try {
    const first = run(['install'], dir)
    assert.equal(first.status, 0, first.stderr)
    for (const name of names)
      for (const d of ['.agents', '.claude']) {
        const link = join(dir, d, 'skills', name)
        assert.ok(lstatSync(link).isSymbolicLink(), link)
        assert.equal(readlinkSync(link), target(join('..', '..'), name))
        assert.ok(existsSync(join(link, 'SKILL.md')), link)
      }
    assert.match(first.stdout, /^installed  pcbjs-basics  link .agents\/skills\/pcbjs-basics  link .claude\/skills\/pcbjs-basics$/m)
    assert.equal(first.stdout.trim().split('\n').length, names.length)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('pcbjs-skills: outside a project it copies into .agents/skills and links .claude/skills to the copy', () => {
  const dir = tmp()
  try {
    const out = run(['install'], dir)
    assert.equal(out.status, 0, out.stderr)
    const copy = join(dir, '.agents', 'skills', 'pcbjs-basics')
    assert.ok(lstatSync(copy).isDirectory() && existsSync(join(copy, 'SKILL.md')))
    assert.equal(readlinkSync(join(dir, '.claude', 'skills', 'pcbjs-basics')), join('..', '..', '.agents', 'skills', 'pcbjs-basics'))
    assert.match(out.stdout, /^installed  pcbjs-basics  copy .agents\/skills\/pcbjs-basics  link .claude\/skills\/pcbjs-basics$/m)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('pcbjs-skills: re-running replaces a copy, a folder or a stale link by a link, and leaves other folders alone', () => {
  const dir = tmp()
  try {
    run(['install'], dir)
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
    const again = run(['install'], dir)
    assert.equal(again.status, 0, again.stderr)
    assert.match(again.stdout, /^updated    pcbjs-basics  link .agents\/skills\/pcbjs-basics  link .claude\/skills\/pcbjs-basics$/m)
    for (const name of names) for (const d of ['.agents', '.claude']) assert.equal(readlinkSync(join(dir, d, 'skills', name)), target(join('..', '..'), name))
    assert.ok(existsSync(join(claude, 'mine')) && existsSync(join(dir, 'elsewhere', 'keep.md')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('pcbjs-skills: --to installs into that folder alone, --no-claude skips the companion', () => {
  const dir = project()
  try {
    const to = run(['install', '--to', 'agents'], dir)
    assert.equal(to.status, 0, to.stderr)
    assert.equal(readlinkSync(join(dir, 'agents', 'pcbjs-upgrade')), target('..', 'pcbjs-upgrade'))
    assert.ok(existsSync(join(dir, 'agents', 'pcbjs-upgrade', 'references', 'pre-0.1.md')))
    assert.match(to.stdout, /^installed  pcbjs-basics  link agents\/pcbjs-basics$/m)
    assert.ok(!existsSync(join(dir, '.claude')) && !existsSync(join(dir, '.agents')))
    const bare = run(['install', '--no-claude'], dir)
    assert.equal(bare.status, 0, bare.stderr)
    assert.ok(existsSync(join(dir, '.agents', 'skills', 'pcbjs-basics', 'SKILL.md')))
    assert.ok(!existsSync(join(dir, '.claude')))
    assert.match(bare.stdout, /^installed  pcbjs-basics  link .agents\/skills\/pcbjs-basics$/m)
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
    assert.equal(installLine(done[0], dir), 'installed  pcbjs-basics  copy .agents/skills/pcbjs-basics  copy .claude/skills/pcbjs-basics')
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

test('pcbjs-skills: list, path and usage errors', () => {
  const dir = tmp()
  try {
    const list = run(['list'], dir).stdout.trim().split('\n')
    assert.equal(list.length, names.length)
    assert.match(list[0], /^pcbjs-basics\s+Design a PCB in pcbjs/)
    assert.equal(run(['path'], dir).stdout.trim(), root)
    assert.equal(run(['nonsense'], dir).status, 1)
    assert.equal(run(['list', '--to', 'x'], dir).status, 1)
    assert.equal(run(['list', '--no-claude'], dir).status, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

const CHANGELOG = `# @pcbjs/core

## 0.2.1

### Patch Changes

- abc123: Fix a thing.

## 0.2.0

### Minor Changes

- def456: Rename foo to bar.

  #### Migration

  Replace \`foo(\` with \`bar(\`.

- 789abc: Other change.

## 0.1.0

### Migration

Move to the scoped packages.

### Minor Changes

- First release.
`

test('sync-changelog: Migration sections per minor, newest first, one per text across packages', () => {
  assert.deepEqual(migrations(CHANGELOG), [
    { version: '0.2.0', body: 'Replace `foo(` with `bar(`.' },
    { version: '0.1.0', body: 'Move to the scoped packages.' },
  ])
  const text = render([
    { name: '@pcbjs/core', text: CHANGELOG },
    { name: '@pcbjs/lib', text: CHANGELOG },
  ])
  assert.match(
    text,
    /## 0\.2\n\n### 0\.2\.0, @pcbjs\/core, @pcbjs\/lib\n\nReplace `foo\(` with `bar\(`\.\n\n## 0\.1\n\n### 0\.1\.0, @pcbjs\/core, @pcbjs\/lib\n\nMove to the scoped packages\.\n$/,
  )
  assert.match(render([]), /No release has a Migration section yet/)
})

test('sync-changelog: the script writes the reference file it is given', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pcbjs-changelog-'))
  try {
    writeFileSync(join(dir, 'CHANGELOG.md'), CHANGELOG)
    const out = join(dir, 'out.md')
    const r = spawnSync(process.execPath, [join(pkg, 'scripts', 'sync-changelog.mjs'), '--out', out, join(dir, 'CHANGELOG.md')], { encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr)
    assert.match(readFileSync(out, 'utf8'), /### 0\.2\.0, pcbjs/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
