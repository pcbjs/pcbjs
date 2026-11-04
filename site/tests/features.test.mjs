// The feature catalogue: the loader's checks, every docs topic claimed, docs/support.md generated from it, and in the built site the
// home page's key cards, /features and the examples index with the basic path first.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CATEGORIES, checkFeatures, matrix, readFeatures, repo } from '../scripts/features.mjs'

const site = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = process.env.PCBJS_SITE_DIST ? resolve(process.env.PCBJS_SITE_DIST) : join(site, '.vitepress/dist')
const skip = existsSync(join(dist, 'index.html')) ? false : 'the site is not built: npm run docs:build'
const features = readFeatures()
const built = features.filter(f => f.status !== 'planned')
// every fixture as a board with every view, so the catalogue checks run without compiling
const anyBoard = new Map(built.map(f => [f.fixture, { views: ['2d', '3d', 'sch'] }]))

const shipped = {
  id: 'x',
  category: 'routing',
  title: 'X',
  status: 'shipped',
  docs: 'routing',
  fixture: 'examples/demo/coin.pcb.tsx',
  view: '2d',
  flag: 'route(a, b)',
  evidence: 'site/tests/features.test.mjs',
  summary: 'X does a thing.',
}
const coin = new Map([['examples/demo/coin.pcb.tsx', { views: ['2d', '3d'] }]])

test('the loader throws on a dangling docs topic, fixture or board', () => {
  assert.doesNotThrow(() => checkFeatures([shipped], { boards: coin }))
  assert.throws(() => checkFeatures([{ ...shipped, docs: 'no-such-topic' }], { boards: coin }), /docs topic "no-such-topic" is not in docs\//)
  assert.throws(() => checkFeatures([{ ...shipped, fixture: 'examples/demo/gone.pcb.tsx' }], { boards: coin }), /fixture examples\/demo\/gone\.pcb\.tsx does not exist/)
  assert.throws(() => checkFeatures([shipped], { boards: new Map() }), /no board was compiled from examples\/demo\/coin\.pcb\.tsx/)
  assert.throws(() => checkFeatures([{ ...shipped, view: 'sch' }], { boards: coin }), /view "sch"/)
  assert.throws(() => checkFeatures([{ id: 'y', category: 'output', title: 'Y', status: 'planned', docs: 'fab' }], { boards: coin }), /title only/)
})

test('the loader reads a category folder of files, and refuses an unknown category or field', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pcbjs-features-'))
  try {
    mkdirSync(join(dir, 'checks'))
    writeFileSync(join(dir, 'checks', 'a.md'), '---\ntitle: A\nstatus: planned\n---\n')
    writeFileSync(join(dir, 'checks', 'b.md'), '---\ntitle: B\nstatus: shipped\ndocs: rules\nkey: true\n---\n\nB checks.\n')
    const [b, a] = readFeatures(dir)
    assert.deepEqual(a, { id: 'a', category: 'checks', title: 'A', status: 'planned' })
    assert.deepEqual(b, { id: 'b', category: 'checks', title: 'B', status: 'shipped', docs: 'rules', key: true, summary: 'B checks.' })
    writeFileSync(join(dir, 'checks', 'c.md'), '---\ntitle: C\ncolour: red\n---\n')
    assert.throws(() => readFeatures(dir), /unknown field "colour"/)
    rmSync(join(dir, 'checks', 'c.md'))
    mkdirSync(join(dir, 'misc'))
    assert.throws(() => readFeatures(dir), /misc: not a category/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('every feature names a topic, fixture and evidence that exist, and every category has a key card', () => {
  checkFeatures(features, { boards: anyBoard })
  for (const c of CATEGORIES)
    assert.ok(
      features.some(f => f.category === c && f.key),
      `${c} has no key card`,
    )
})

test('every docs topic with a Basic or Advanced marker is claimed by a feature', () => {
  const marked = readdirSync(join(repo, 'docs'))
    .filter(f => f.endsWith('.md'))
    .filter(f => /^(Basic|Advanced)\.\s/m.test(readFileSync(join(repo, 'docs', f), 'utf8').split('\n## ')[0]))
    .map(f => f.slice(0, -3))
  assert.ok(marked.length > 50, `${marked.length} topics with a marker`)
  const claimed = new Set(built.map(f => f.docs))
  assert.deepEqual(
    marked.filter(t => !claimed.has(t)),
    [],
  )
})

test('docs/support.md is the matrix of the catalogue, a status each', () => {
  assert.equal(readFileSync(join(repo, 'docs/support.md'), 'utf8'), matrix(features), 'run node site/scripts/features.mjs --write')
  const text = matrix([
    { ...shipped, category: 'design' },
    { ...shipped, id: 'b', title: 'Half | done', status: 'beta', evidence: 'Not all of it.' },
    { id: 'c', category: 'routing', title: 'Later', status: 'planned' },
  ])
  assert.match(text, /^1 supported, 1 partial, 1 missing\./m)
  assert.match(text, /## Design\n\n\| Feature \| Support \| Evidence \|\n\| --- \| --- \| --- \|\n\| X \| supported \| `site\/tests\/features\.test\.mjs` \|\n/)
  assert.match(text, /## Routing\n\n.*\n.*\n\| Half \\\| done \| partial \| Not all of it\. \|\n\| Later \| missing \| planned \|\n/)
  assert.doesNotMatch(text, /## Checks/)
})

test('examples/README.md lists the basic path first: blinky, coin and qfn-breakout', () => {
  const text = readFileSync(join(repo, 'examples/README.md'), 'utf8')
  const basic = text.split('\n## Basic\n')[1].split('\n## ')[0]
  assert.deepEqual(
    [...basic.matchAll(/^\| `([^`]+)` \|/gm)].map(m => m[1]),
    ['demo/blinky.pcb.tsx', 'demo/coin.pcb.tsx', 'qfn-breakout/pcb.tsx'],
  )
  assert.ok(text.indexOf('\n## Basic\n') < text.indexOf('\n## Advanced\n'))
  assert.doesNotMatch(text.split('\n## Advanced\n')[1], /^\| `qfn-breakout` \|/m)
})

test('the home page shows one card per key feature', { skip }, () => {
  const html = readFileSync(join(dist, 'index.html'), 'utf8')
  const keys = features.filter(f => f.key)
  assert.equal([...html.matchAll(/class="row key-card"/g)].length, keys.length)
  for (const f of keys) assert.ok(html.includes(f.title.replace(/'/g, '&#39;')), f.title)
  assert.ok(html.includes('class="install"'), 'the install hero stays')
})

test('/features shows every built feature by category and the planned ones as the roadmap', { skip }, () => {
  const html = readFileSync(join(dist, 'features.html'), 'utf8')
  const esc = s => s.replace(/&/g, '&amp;').replace(/'/g, '&#39;')
  assert.equal([...html.matchAll(/class="feature"/g)].length, built.length)
  for (const f of features) assert.ok(html.includes(esc(f.title)), f.title)
  const at = id => html.indexOf(`id="${id}"`)
  for (const [i, c] of CATEGORIES.entries()) assert.ok(at(c) > (i ? at(CATEGORIES[i - 1]) : 0), c)
  const roadmap = html.slice(at('roadmap'))
  for (const f of features.filter(f => f.status === 'planned')) assert.ok(roadmap.includes(esc(f.title)), `${f.title} is on the roadmap`)
})

test('the examples index shows the basic path, then a divider, then the advanced boards', { skip }, () => {
  const html = readFileSync(join(dist, 'examples.html'), 'utf8')
  const divider = html.indexOf('class="level-divider"')
  assert.ok(html.indexOf('id="basic"') < divider && divider > 0)
  const names = [...html.matchAll(/<div class="name"[^>]*>([^<]+)<\/div>/g)]
  assert.equal(names.filter(m => m.index < divider).length, 3)
  assert.ok(names.filter(m => m.index > divider).length > 10)
  for (const where of ['examples/demo<', 'examples/qfn-breakout<']) assert.ok(html.indexOf(where) < divider, where)
})
