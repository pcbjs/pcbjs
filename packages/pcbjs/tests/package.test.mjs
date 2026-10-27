// @pcbjs/pcbjs installs every component and the pcbjs bin, which runs @pcbjs/cli; it has no code of its own.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8'))

test('package: depends on every component at its own version, vscode aside', () => {
  const components = readdirSync(resolve(PKG, '..')).filter(d => d !== 'pcbjs' && d !== 'vscode')
  for (const d of components) {
    const c = JSON.parse(readFileSync(resolve(PKG, '..', d, 'package.json'), 'utf8'))
    assert.equal(pkg.dependencies[c.name], c.version, c.name)
  }
  assert.deepEqual(pkg.files, ['bin'])
})

test('package: the pcbjs bin runs the CLI', () => {
  assert.equal(pkg.bin.pcbjs, 'bin/pcbjs.js')
  const out = execFileSync(process.execPath, [join(PKG, 'bin', 'pcbjs.js'), '--version'], { encoding: 'utf8' })
  assert.match(out, /^pcbjs \d+\.\d+\.\d+\S*: @pcbjs\/cli /)
})
