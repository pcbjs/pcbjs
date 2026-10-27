// `pcbjs --version` is one line, the meta package's version and every @pcbjs package's, and `pcbjs --help` starts with it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { versionLine } from '../dist/version.js'

const BIN = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'pcbjs', 'bin', 'pcbjs.js')
const run = (...args) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } }).stdout

test('--version: one line with the meta version and every @pcbjs package; --help starts with it', () => {
  const v = run('--version').trimEnd()
  assert.equal(v.split('\n').length, 1)
  assert.match(v, /^pcbjs \d+\.\d+\.\d+\S*: @pcbjs\/cli \S+, .*@pcbjs\/core \S+/)
  assert.doesNotMatch(v, /@pcbjs\/pcbjs/)
  assert.equal(run('-v').trimEnd(), v)
  assert.equal(run('--help').split('\n')[0], v)
})

test('versionLine: the project\'s own packages, the meta package first', () => {
  const root = mkdtempSync(join(tmpdir(), 'pcbjs-version-'))
  try {
    for (const [name, version] of [['pcbjs', '0.1.0-beta.1'], ['core', '0.1.0-beta.1'], ['lib', '0.1.0']]) {
      mkdirSync(join(root, 'node_modules', '@pcbjs', name), { recursive: true })
      writeFileSync(join(root, 'node_modules', '@pcbjs', name, 'package.json'), JSON.stringify({ name: `@pcbjs/${name}`, version }))
    }
    assert.equal(versionLine(root), 'pcbjs 0.1.0-beta.1: @pcbjs/core 0.1.0-beta.1, @pcbjs/lib 0.1.0')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
