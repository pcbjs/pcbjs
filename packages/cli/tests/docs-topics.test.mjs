// Every docs/ topic stays under 12 kB, is in the reading order of `pcbjs docs` and in the README's topic table.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TOPICS } from '../dist/docs.js'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const DOCS = join(REPO, 'docs')
const topics = readdirSync(DOCS).filter(f => f.endsWith('.md')).map(f => f.slice(0, -3))
const LIMIT = 12 * 1024

test('every topic is at most 12 kB', () => {
  const over = topics.map(t => [t, statSync(join(DOCS, `${t}.md`)).size]).filter(([, n]) => n > LIMIT)
  assert.deepEqual(over.map(([t, n]) => `${t}.md ${(n / 1024).toFixed(1)} kB`), [])
})

test('every topic is in the reading order and the README table', () => {
  const readme = readFileSync(join(REPO, 'README.md'), 'utf8')
  assert.deepEqual(topics.filter(t => !TOPICS.includes(t)), [])
  assert.deepEqual(topics.filter(t => !readme.includes(`\`${t}\``)), [])
})
