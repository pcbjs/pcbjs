// .github/workflows/diff.yml parses, runs on pull requests to main and beta2, asks only for pull-requests: write and runs pcbjs diff.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

test('the diff workflow parses and asks for pull-requests: write alone', () => {
  const wf = parse(readFileSync(join(REPO, '.github', 'workflows', 'diff.yml'), 'utf8'))
  assert.deepEqual(wf.on.pull_request.branches, ['main', 'beta2'])
  assert.deepEqual(wf.permissions, { 'pull-requests': 'write' })
  const steps = wf.jobs.diff.steps
  assert.ok(
    steps.some(s => /pcbjs\.js" diff /.test(s.run ?? '')),
    'a step runs pcbjs diff',
  )
  assert.ok(
    steps.some(s => s.uses?.startsWith('actions/upload-artifact@')),
    'a step uploads the images',
  )
  assert.ok(
    steps.some(s => s.uses?.startsWith('actions/github-script@') && s.with.script.includes('updateComment')),
    'a step posts or updates the comment',
  )
})
