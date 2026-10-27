import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { skills } from '../dist/skills.js'

test('skills: install copies every skill of @pcbjs/skills, and an unknown action fails', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pcbjs-cli-skills-'))
  const log = console.log
  try {
    console.log = () => {}
    assert.equal(await skills('install', { cwd: dir }), 0)
    assert.equal(await skills('install', { cwd: dir, to: 'agents' }), 0)
    assert.equal(await skills('bogus', { cwd: dir }), 1)
  } finally {
    console.log = log
  }
  try {
    for (const d of ['.claude/skills', 'agents']) assert.ok(existsSync(join(dir, d, 'pcbjs-basics', 'SKILL.md')), d)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
