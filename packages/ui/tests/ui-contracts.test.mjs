import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { registerHooks } from 'node:module'

registerHooks({
  resolve: (spec, ctx, next) => {
    try {
      return next(spec, ctx)
    } catch (e) {
      if (spec.startsWith('.') && !spec.endsWith('.ts')) return next(spec + '.ts', ctx)
      throw e
    }
  },
})
const { KEYS } = await import('../src/keys.ts')
const root = new URL('../../../', import.meta.url)
const inventory = JSON.parse(readFileSync(new URL('scripts/ui-contracts.json', root), 'utf8'))

test('UI contracts: every shared key command maps to exactly one operation', () => {
  const commands = inventory.operations.flatMap(op => op.commands)
  assert.deepEqual([...commands].sort(), KEYS.map(key => key.id).sort())
  assert.equal(new Set(commands).size, commands.length)
})

test('UI contracts: inventory has actionable boundaries and valid source/test references', () => {
  assert.equal(inventory.version, 1)
  const ids = new Set()
  const doc = readFileSync(new URL('docs/interaction.md', root), 'utf8')
  for (const op of inventory.operations) {
    assert.match(op.id, /^[A-Z]+\d{2}$/)
    assert.ok(!ids.has(op.id), `duplicate ${op.id}`)
    ids.add(op.id)
    assert.ok(doc.includes(`| ${op.id} `), `${op.id} missing from public index`)
    for (const field of ['title', 'context', 'result', 'boundary', 'unavailable', 'missingAcceptance']) assert.ok(typeof op[field] === 'string' && op[field].trim(), `${op.id}: ${field}`)
    assert.ok(['supported', 'unsupported'].includes(op.support))
    assert.equal(op.coverage, 'source-only', 'this inventory does not claim executed runtime acceptance')
    assert.ok(op.sources.length)
    if (op.support === 'supported') assert.ok(op.tests.length, `${op.id}: supported operation needs a test reference`)
    for (const path of [...op.sources, ...op.tests]) {
      assert.match(path, /^packages\/[\w/-]+\.[\w.]+$/)
      assert.ok(statSync(new URL(path, root)).isFile(), `${op.id}: ${path}`)
    }
  }
  assert.ok(Buffer.byteLength(doc) < 12288)
})
