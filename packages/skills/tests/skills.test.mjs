import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrations, render } from '../scripts/sync-changelog.mjs'

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const root = join(pkg, 'skills')
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

test('skills: no em-dash and no path to an untracked note', () => {
  for (const name of names)
    for (const file of readdirSync(join(root, name), { recursive: true }).filter(f => f.endsWith('.md'))) {
      const text = readFileSync(join(root, name, file), 'utf8')
      assert.ok(!text.includes('—'), `${name}/${file}: em-dash`)
      assert.ok(!/\b(CLAUDE|REVIEW|PORT|IMPROVEMENTS)\.md\b/.test(text), `${name}/${file}: names an untracked note`)
    }
})

test('pcbjs-skills: install, list and path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pcbjs-skills-'))
  try {
    const first = run(['install'], dir)
    assert.equal(first.status, 0, first.stderr)
    for (const name of names) assert.ok(existsSync(join(dir, '.claude', 'skills', name, 'SKILL.md')), name)
    assert.match(first.stdout, /installed  pcbjs-basics  .claude\/skills\/pcbjs-basics/)
    assert.match(run(['install'], dir).stdout, /updated    pcbjs-basics/)
    assert.equal(run(['install', '--to', 'agents'], dir).status, 0)
    assert.ok(existsSync(join(dir, 'agents', 'pcbjs-upgrade', 'references', 'pre-0.1.md')))
    const list = run(['list'], dir).stdout.trim().split('\n')
    assert.equal(list.length, names.length)
    assert.match(list[0], /^pcbjs-basics\s+Design a PCB in pcbjs/)
    assert.equal(run(['path'], dir).stdout.trim(), root)
    assert.equal(run(['nonsense'], dir).status, 1)
    assert.equal(run(['list', '--to', 'x'], dir).status, 1)
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
