import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { releaseTarget } from '../../../scripts/release-state.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const state = { pending: false, exiting: false, version: '0.1.0', head: 'main-sha', subject: 'pcbjs 0.1.0' }

test('release: only pending changes or an explicit prerelease exit start a new train', () => {
  assert.throws(() => releaseTarget(state), /No pending changesets/)
  assert.equal(releaseTarget({ ...state, pending: true }).mode, 'new')
  assert.equal(releaseTarget({ ...state, exiting: true }).mode, 'new')
})

test('release: an untagged recovery must name the version commit, never arbitrary main', () => {
  assert.deepEqual(releaseTarget({ ...state, resume: '0.1.0' }), { mode: 'resume', ref: 'main-sha', publish: true, tagged: false })
  for (const bad of [{ version: '0.1.1' }, { subject: 'Fix something else' }, { pending: true }, { exiting: true }]) {
    assert.throws(() => releaseTarget({ ...state, resume: '0.1.0', ...bad }), /version commit/)
  }
  for (const resume of ['main', '0.1.0\nref=evil', '../0.1.0', '--help']) assert.throws(() => releaseTarget({ ...state, resume }), /exact package version/)
})

test('release: a tagged recovery uses that train even after main moves, and never republishes npm', () => {
  const tag = { ref: 'train-sha', version: '0.1.0', subject: 'pcbjs 0.1.0', ancestor: true }
  const next = { ...state, version: '0.2.0', subject: 'More development', pending: true, resume: '0.1.0', tag }
  assert.deepEqual(releaseTarget(next), { mode: 'resume', ref: 'train-sha', publish: false, tagged: true })
  for (const bad of [{ version: '0.1.1' }, { subject: 'Other commit' }, { ancestor: false }]) assert.throws(() => releaseTarget({ ...next, tag: { ...tag, ...bad } }), /release tag/)
})

test('release: the command resolves actual git tags and writes only the selected train outputs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pcbjs-release-state-'))
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  try {
    mkdirSync(join(dir, 'packages/pcbjs'), { recursive: true })
    mkdirSync(join(dir, '.changeset'))
    writeFileSync(join(dir, 'packages/pcbjs/package.json'), JSON.stringify({ name: '@pcbjs/pcbjs', version: '0.1.0' }))
    git('init', '-q')
    git('config', 'user.name', 'Release test')
    git('config', 'user.email', 'release@example.invalid')
    git('config', 'commit.gpgsign', 'false')
    git('config', 'tag.gpgsign', 'false')
    git('add', 'packages/pcbjs/package.json')
    git('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'pcbjs 0.1.0')
    const ref = git('rev-parse', 'HEAD')
    git('tag', '@pcbjs/pcbjs@0.1.0')
    writeFileSync(join(dir, '.changeset/next.md'), "---\n'@pcbjs/core': patch\n---\n\nNext fix\n")
    git('add', '.changeset/next.md')
    git('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'Develop the next train')
    const output = join(dir, 'output')
    execFileSync(process.execPath, [join(REPO, 'scripts/release-state.mjs')], { cwd: dir, env: { ...process.env, RESUME_VERSION: '0.1.0', GITHUB_OUTPUT: output } })
    assert.equal(readFileSync(output, 'utf8'), `mode=resume\nref=${ref}\npublish=false\ntagged=true\n`)
    assert.equal(git('status', '--porcelain'), '?? output')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('release: dry runs validate the versioned tree before any push, and resumed trains skip extension publication', () => {
  const wf = parse(readFileSync(join(REPO, '.github/workflows/release.yml'), 'utf8'))
  const steps = wf.jobs.release.steps
  const push = steps.findIndex(s => s.name === 'Push the version commit to main')
  for (const command of ['npm run build', 'npm run package -w @pcbjs/vscode', 'npm test', 'node scripts/check-examples.mjs', 'node scripts/stage-equality.mjs', 'npm run demo:build', 'node scripts/pack-smoke.mjs']) {
    const index = steps.findIndex(s => s.run === command)
    assert.ok(index >= 0 && index < push, `${command} must pass before push`)
    assert.equal(steps[index].if, undefined, `${command} must also run in a dry run`)
  }
  const publish = steps.find(s => s.name === 'Publish missing npm packages')
  assert.match(publish.if, /steps\.train\.outputs\.publish == 'true'/)
  assert.match(publish.if, /env\.DRY_RUN != 'true'/)
  const extension = steps.find(s => s.id === 'vscode')
  assert.match(extension.if, /steps\.train\.outputs\.mode == 'new'/)
  for (const name of ['Visual Studio Marketplace', 'Open VSX']) assert.match(steps.find(s => s.name === name).if, /steps\.tokens\.outputs/)
  assert.equal(wf.on.workflow_dispatch.inputs.resume_version.type, 'string')
})
