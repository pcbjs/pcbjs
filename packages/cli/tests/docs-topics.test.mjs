// Every docs/ topic is discoverable in the CLI reading order and README, with a basic or advanced level.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { levelOf, TOPICS, topicTable } from '../dist/docs.js'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const DOCS = join(REPO, 'docs')
const topics = readdirSync(DOCS)
  .filter(f => f.endsWith('.md'))
  .map(f => f.slice(0, -3))
test('every topic is in the reading order and the README table', () => {
  const readme = readFileSync(join(REPO, 'README.md'), 'utf8')
  assert.deepEqual(
    topics.filter(t => !TOPICS.includes(t)),
    [],
  )
  assert.deepEqual(
    topics.filter(t => !readme.includes(`\`${t}\``)),
    [],
  )
})

test('every topic is marked basic or advanced, the basic path first, and in that table of the README', () => {
  const readme = readFileSync(join(REPO, 'README.md'), 'utf8')
  const table = h => readme.slice(readme.indexOf(`### ${h}\n`)).split('\n\n')[1]
  const level = t => levelOf(readFileSync(join(DOCS, `${t}.md`), 'utf8'))
  assert.deepEqual(
    topics.filter(t => !level(t)),
    [],
  )
  const order = TOPICS.filter(t => topics.includes(t)).map(level)
  assert.ok(order.lastIndexOf('basic') < order.indexOf('advanced'))
  for (const t of topics) {
    const h = level(t) === 'basic' ? 'Basics' : 'Advanced'
    assert.ok(table(h).includes(`| \`${t}\` |`), `${t} is not in the README's ${h} table`)
  }
})

test('pcbjs docs lists the basics first under their own heading', () => {
  const lines = topicTable(DOCS)
  const basics = lines.indexOf('Basics, a first board in order:')
  const advanced = lines.indexOf('Advanced:')
  assert.ok(basics > 0 && basics < advanced)
  assert.match(lines[basics + 1], /^ {2}basics /)
  assert.match(lines[advanced + 1], /^ {2}advanced /)
})
