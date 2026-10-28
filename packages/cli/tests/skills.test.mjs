import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs, { existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { skills } from '../dist/skills.js'

const pkg = dirname(createRequire(import.meta.url).resolve('@pcbjs/skills/package.json'))
const target = (up, name) => join(up, 'node_modules', '@pcbjs', 'skills', name)

async function quiet(run) {
  const lines = []
  const log = console.log
  console.log = line => lines.push(line)
  try {
    return { code: await run(), lines }
  } finally {
    console.log = log
  }
}

const inTmp = (project, body) => async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pcbjs-cli-skills-'))
  if (project) {
    mkdirSync(join(dir, 'node_modules', '@pcbjs'), { recursive: true })
    symlinkSync(pkg, join(dir, 'node_modules', '@pcbjs', 'skills'))
  }
  try {
    await body(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test(
  'skills: install links .agents/skills and .claude/skills into node_modules and replaces a copy on a re-run',
  inTmp(true, async dir => {
    mkdirSync(join(dir, '.claude', 'skills', 'pcbjs-basics'), { recursive: true })
    writeFileSync(join(dir, '.claude', 'skills', 'pcbjs-basics', 'SKILL.md'), 'an old copy')
    const first = await quiet(() => skills('install', { cwd: dir }))
    assert.equal(first.code, 0)
    assert.ok(first.lines.includes('installed  pcbjs-basics  link .agents/skills/pcbjs-basics  link .claude/skills/pcbjs-basics'))
    for (const d of ['.agents', '.claude']) {
      const link = join(dir, d, 'skills', 'pcbjs-basics')
      assert.ok(lstatSync(link).isSymbolicLink())
      assert.equal(readlinkSync(link), target(join('..', '..'), 'pcbjs-basics'))
      assert.ok(existsSync(join(link, 'references')))
    }
    const again = await quiet(() => skills('install', { cwd: dir }))
    assert.ok(again.lines.includes('updated    pcbjs-basics  link .agents/skills/pcbjs-basics  link .claude/skills/pcbjs-basics'))
  }),
)

test(
  'skills: outside a project, or where no symlink can be made, it copies and says so',
  inTmp(false, async dir => {
    const out = await quiet(() => skills('install', { cwd: dir }))
    assert.ok(out.lines.includes('installed  pcbjs-basics  copy .agents/skills/pcbjs-basics  link .claude/skills/pcbjs-basics'))
    const symlink = fs.symlinkSync
    fs.symlinkSync = () => {
      throw Object.assign(new Error('EPERM'), { code: 'EPERM' })
    }
    try {
      const { lines } = await quiet(() => skills('install', { cwd: dir }))
      assert.ok(lines.includes('updated    pcbjs-basics  copy .agents/skills/pcbjs-basics  copy .claude/skills/pcbjs-basics'))
      assert.ok(lstatSync(join(dir, '.claude', 'skills', 'pcbjs-basics')).isDirectory())
    } finally {
      fs.symlinkSync = symlink
    }
  }),
)

test(
  'skills: --to installs there alone, --no-claude skips the companion, an unknown action fails',
  inTmp(true, async dir => {
    const to = await quiet(() => skills('install', { cwd: dir, to: 'agents' }))
    assert.equal(to.code, 0)
    assert.ok(to.lines.includes('installed  pcbjs-basics  link agents/pcbjs-basics'))
    assert.equal(readlinkSync(join(dir, 'agents', 'pcbjs-basics')), target('..', 'pcbjs-basics'))
    assert.ok(!existsSync(join(dir, '.claude')) && !existsSync(join(dir, '.agents')))
    assert.equal((await quiet(() => skills('install', { cwd: dir, claude: false }))).code, 0)
    assert.ok(existsSync(join(dir, '.agents', 'skills', 'pcbjs-basics', 'SKILL.md')))
    assert.ok(!existsSync(join(dir, '.claude')))
    const err = console.error
    console.error = () => {}
    try {
      assert.equal(await skills('bogus', { cwd: dir }), 1)
    } finally {
      console.error = err
    }
  }),
)
